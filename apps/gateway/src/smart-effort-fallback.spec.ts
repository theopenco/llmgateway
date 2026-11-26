import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { resetKeyHealth } from "./lib/api-key-health.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";

// glm-5.3 is the motivating case: zai accepts `low`, fireworks accepts only
// xhigh/max. An auto-routed effort therefore has to be re-picked per mapping,
// and the advertised x-llmgateway-smart-effort header has to follow the body
// that was actually sent.
const MODEL = "glm-5.3";
const SUPPORTS_LOW = "zai";
const REJECTS_LOW = "fireworks";

describe("auto reasoning effort across a fallback", () => {
	const harness = createGatewayApiTestHarness();
	beforeEach(resetKeyHealth);

	afterEach(() => {
		vi.restoreAllMocks();
	});

	async function setup() {
		await harness.setProjectMode("api-keys");
		await db
			.update(tables.project)
			.set({ smartRoutingConfig: { classifier: "none", models: [MODEL] } })
			.where(eq(tables.project.id, "project-id"));
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("test-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});
		for (const provider of [SUPPORTS_LOW, REJECTS_LOW]) {
			const id = `provider-key-${provider}`;
			await db.insert(tables.providerKey).values({
				id,
				provider,
				organizationId: "org-id",
				...encryptProviderKeyForStorage(`test-${provider}`, id, "org-id"),
				allowedModels: [MODEL],
				baseUrl: `https://${provider}.example.com`,
			});
			await harness.setRoutingMetrics(MODEL, provider, { uptime: 100 });
		}
	}

	function mockUpstreams(failing: string) {
		const attempts: string[] = [];
		const bodies: string[] = [];
		const fetch = globalThis.fetch;
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			const url = new URL(
				input instanceof Request ? input.url : input.toString(),
			);
			attempts.push(url.hostname.split(".")[0]);
			bodies.push(typeof init?.body === "string" ? init.body : "");
			if (url.hostname.startsWith(failing)) {
				return Response.json(
					{ error: { message: "Rate limit exceeded" } },
					{ status: 429 },
				);
			}
			return await fetch(`${harness.mockServerUrl}/v1/chat/completions`, init);
		});
		return { attempts, bodies };
	}

	async function request(extra: Record<string, unknown> = {}) {
		return await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				Authorization: "Bearer test-token",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: "smart",
				stream: false,
				max_tokens: 1024,
				messages: [{ role: "user", content: "Hello!" }],
				...extra,
			}),
		});
	}

	test("clears the advertised effort when the fallback mapping rejects it", async () => {
		await setup();
		const { attempts, bodies } = mockUpstreams(SUPPORTS_LOW);
		const res = await request();

		expect(res.status).toBe(200);
		expect(attempts).toEqual([SUPPORTS_LOW, REJECTS_LOW]);
		expect(res.headers.get("x-llmgateway-smart-model")).toBe(MODEL);
		// fireworks publishes no `low`, so the re-pick yields no effort and the
		// header the first attempt advertised has to be removed.
		expect(res.headers.get("x-llmgateway-smart-effort")).toBeNull();
		expect(JSON.parse(bodies[0]).reasoning_effort).toBe("low");
		expect(JSON.parse(bodies[1]).reasoning_effort).toBeUndefined();
	});

	test("keeps a caller-set effort across the fallback", async () => {
		await setup();
		const { attempts, bodies } = mockUpstreams(SUPPORTS_LOW);
		const res = await request({ reasoning_effort: "max" });

		expect(res.status).toBe(200);
		expect(attempts).toEqual([SUPPORTS_LOW, REJECTS_LOW]);
		expect(res.headers.get("x-llmgateway-smart-effort")).toBe("max");
		expect(JSON.parse(bodies[0]).reasoning_effort).toBe("max");
		expect(JSON.parse(bodies[1]).reasoning_effort).toBe("max");
	});
});
