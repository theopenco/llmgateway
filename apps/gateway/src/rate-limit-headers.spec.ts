import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import { readAll, waitForLogs } from "./test-utils/test-helpers.js";

const upstreamHeaders = {
	"Retry-After": "99999",
	"retry-after-ms": "99999000",
	"RateLimit-Limit": "99999",
	"RateLimit-Remaining": "0",
	"RateLimit-Reset": "99999",
	"X-RateLimit-Limit-Requests": "99999",
	"X-RateLimit-Remaining-Tokens": "0",
	"anthropic-ratelimit-requests-reset": "2099-01-01T00:00:00Z",
};

describe("client rate-limit headers", () => {
	const harness = createGatewayApiTestHarness();
	let upstreamFailuresRemaining = 0;
	let upstreamCalls = 0;

	async function addProviderKey(id: string) {
		await db.insert(tables.providerKey).values({
			id,
			...encryptProviderKeyForStorage(`test-${id}`, id, "org-id"),
			provider: "openai",
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
		});
	}

	beforeEach(async () => {
		vi.stubEnv("GATEWAY_RATE_LIMITS_ENABLED", "true");
		vi.stubEnv("GATEWAY_RATE_LIMIT_CHAT_COMPLETIONS_RPM", "600");
		upstreamFailuresRemaining = 0;
		upstreamCalls = 0;
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("test-token"),
			projectId: "project-id",
			createdBy: "user-id",
			description: "Test API Key",
		});
		await addProviderKey("provider-key-id");
		await db.insert(tables.rateLimit).values({
			id: "rate-limit-openai",
			organizationId: "org-id",
			provider: "openai",
			model: "gpt-4o-mini",
			maxRpm: 20,
			maxRpd: 100,
		});

		const originalFetch = globalThis.fetch;
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			const url = input instanceof Request ? input.url : String(input);
			if (!url.startsWith(harness.mockServerUrl)) {
				return await originalFetch(input, init);
			}
			upstreamCalls++;
			if (upstreamFailuresRemaining > 0) {
				upstreamFailuresRemaining--;
				return Response.json(
					{
						error: { message: "Rate limit exceeded", type: "rate_limit_error" },
					},
					{ status: 429, headers: upstreamHeaders },
				);
			}
			const response = await originalFetch(input, init);
			const headers = new Headers(response.headers);
			for (const [name, value] of Object.entries(upstreamHeaders)) {
				headers.set(name, value);
			}
			return new Response(response.body, { status: response.status, headers });
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	function request(stream: boolean) {
		return app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer test-token",
				"x-no-fallback": "true",
				"x-no-cache": "true",
			},
			body: JSON.stringify({
				model: "openai/gpt-4o-mini",
				messages: [{ role: "user", content: "Hello" }],
				stream,
			}),
		});
	}

	function expectGatewayHeaders(response: Response) {
		expect(response.headers.get("RateLimit-Limit")).toBe("600");
		expect(response.headers.get("RateLimit-Remaining")).toBe("599");
		for (const name of Object.keys(upstreamHeaders)) {
			if (name === "RateLimit-Limit" || name === "RateLimit-Remaining") {
				continue;
			}
			expect(response.headers.get(name), name).toBeNull();
		}
		for (const name of response.headers.keys()) {
			expect(name).not.toMatch(/ratelimit-.*-provider/);
		}
	}

	test.each([false, true])(
		"omits provider quotas on success (stream=%s)",
		async (stream) => {
			const response = await request(stream);
			expect(response.status).toBe(200);
			await response.text();
			expect(upstreamCalls).toBe(1);
			expectGatewayHeaders(response);
			await waitForLogs(1);
		},
	);

	test.each([false, true])(
		"omits upstream headers after failure (stream=%s)",
		async (stream) => {
			upstreamFailuresRemaining = 1;
			const response = await request(stream);
			if (stream) {
				expect(response.status).toBe(200);
				const result = await readAll(response.body);
				expect(result.errorEvents[0].error.type).toBe("upstream_error");
			} else {
				expect(response.status).toBe(500);
				expect(await response.json()).toMatchObject({
					error: { type: "upstream_error" },
				});
			}
			expect(upstreamCalls).toBe(1);
			expectGatewayHeaders(response);
			const logs = await waitForLogs(1);
			expect(logs[0].errorDetails?.statusCode).toBe(429);
		},
	);

	test.each([false, true])(
		"retries upstream throttling without leaking headers (stream=%s)",
		async (stream) => {
			await addProviderKey("alternate-provider-key-id");
			upstreamFailuresRemaining = 1;
			const response = await request(stream);
			expect(response.status).toBe(200);
			if (stream) {
				expect((await readAll(response.body)).hasError).toBe(false);
			} else {
				expect(await response.json()).toHaveProperty("choices");
			}
			expect(upstreamCalls).toBe(2);
			expectGatewayHeaders(response);
			const logs = await waitForLogs(2);
			expect(logs).toContainEqual(
				expect.objectContaining({
					retried: true,
					errorDetails: expect.objectContaining({ statusCode: 429 }),
				}),
			);
		},
	);

	test("preserves gateway throttling and reset headers", async () => {
		vi.stubEnv("GATEWAY_RATE_LIMIT_CHAT_COMPLETIONS_RPM", "1");
		await (await request(false)).text();
		const response = await request(false);
		expect(response.status).toBe(429);
		expect(response.headers.get("RateLimit-Limit")).toBe("1");
		expect(response.headers.get("RateLimit-Remaining")).toBe("0");
		expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
		expect(response.headers.get("RateLimit-Reset")).toBe(
			response.headers.get("Retry-After"),
		);
		expect(response.headers.get("X-RateLimit-Limit")).toBe("1");
		expect(response.headers.get("X-RateLimit-Remaining")).toBe("0");
		expect(Number(response.headers.get("X-RateLimit-Reset"))).toBeGreaterThan(
			Date.now() / 1000,
		);
		expect(upstreamCalls).toBe(1);
		await waitForLogs(1);
	});
});
