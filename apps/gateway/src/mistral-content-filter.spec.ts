import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { getKeyMetrics, resetKeyHealth } from "./lib/api-key-health.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import { waitForLogByRequestId } from "./test-utils/test-helpers.js";

const guardrailError = {
	object: "error",
	message: "Request blocked by guardrail policy",
	type: "guardrail_violation",
	param: null,
	code: "1920",
	raw_status_code: 403,
};

describe("Mistral content filter", () => {
	const harness = createGatewayApiTestHarness();
	let upstreamBody = guardrailError;
	let upstreamCalls = 0;

	beforeEach(async () => {
		resetKeyHealth();
		upstreamCalls = 0;
		upstreamBody = guardrailError;
		await harness.setProjectMode("credits");
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("test-token"),
			projectId: "project-id",
			createdBy: "user-id",
			description: "Test API Key",
		});
		vi.stubEnv("LLM_MISTRAL_API_KEY", "test-token");
		vi.stubEnv("LLM_MISTRAL_BASE_URL", harness.mockServerUrl);
		const originalFetch = globalThis.fetch;
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			const url = new URL(
				typeof input === "string" || input instanceof URL ? input : input.url,
			);
			if (
				!url.href.startsWith(harness.mockServerUrl) &&
				url.hostname !== "api.mistral.ai"
			) {
				return await originalFetch(input, init);
			}
			expect(url.pathname).toBe("/v1/chat/completions");
			upstreamCalls++;
			return Response.json(upstreamBody, {
				status: 403,
				statusText: "Forbidden",
			});
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		resetKeyHealth();
	});

	async function request(path: string, stream: boolean, requestId: string) {
		return await app.request(path, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer test-token",
				"x-request-id": requestId,
				"x-no-fallback": "true",
				"x-no-cache": "true",
			},
			body: JSON.stringify({
				model: "mistral/mistral-large-4",
				stream,
				...(path === "/v1/responses"
					? { input: "Hello" }
					: { messages: [{ role: "user", content: "Hello" }] }),
			}),
		});
	}

	describe.each(["/v1/chat/completions", "/v1/responses"])("%s", (path) => {
		test.each([false, true])(
			"normalizes a guardrail 403 with stream=%s",
			async (stream) => {
				const requestId = randomUUID();
				const res = await request(path, stream, requestId);
				const body = await res.text();
				expect(res.status, body).toBe(200);
				if (stream) {
					expect(body).toContain('"content_filter"');
					expect(body).not.toContain("event: error\n");
					expect(body).not.toContain("event: response.failed\n");
				} else if (path === "/v1/responses") {
					expect(JSON.parse(body)).toMatchObject({
						status: "incomplete",
						incomplete_details: { reason: "content_filter" },
					});
				} else {
					expect(JSON.parse(body).choices[0]).toMatchObject({
						finish_reason: "content_filter",
						message: { content: null },
					});
				}
				const log = await waitForLogByRequestId(requestId);
				expect(log).toMatchObject({
					finishReason: "content_filter",
					unifiedFinishReason: "content_filter",
					hasError: false,
					errorDetails: null,
					usedMode: "credits",
					retried: false,
				});
				expect(Number(log.cost)).toBe(0);
				expect(upstreamCalls).toBe(1);
				expect(
					getKeyMetrics("LLM_MISTRAL_API_KEY", 0, "mistral-large-4")
						.permanentlyBlacklisted,
				).toBe(false);
			},
		);
	});

	test.each([false, true])(
		"keeps an unrelated permission 403 as a key failure with stream=%s",
		async (stream) => {
			upstreamBody = {
				...guardrailError,
				type: "permission_error",
				message: "Access to guardrail_violation is disabled",
			};
			const requestId = randomUUID();
			const res = await request("/v1/chat/completions", stream, requestId);
			const body = await res.text();
			expect(body).toContain('"gateway_error"');
			expect(body).not.toContain('"finish_reason":"content_filter"');
			const log = await waitForLogByRequestId(requestId);
			expect(log).toMatchObject({
				finishReason: "gateway_error",
				hasError: true,
			});
			expect(
				getKeyMetrics("LLM_MISTRAL_API_KEY", 0, "mistral-large-4")
					.permanentlyBlacklisted,
			).toBe(true);
		},
	);
});
