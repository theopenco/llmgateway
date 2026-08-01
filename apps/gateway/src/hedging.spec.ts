import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "vitest";

import { db, tables } from "@llmgateway/db";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import {
	getStallOnceCounter,
	resetFailOnceCounter,
} from "./test-utils/mock-openai-server.js";
import { readAll } from "./test-utils/test-helpers.js";

// Integration coverage for upstream TTFB hedging (lib/hedged-fetch.ts): when
// UPSTREAM_HEDGE_DELAY_MS is set and the primary upstream attempt produces no
// response headers within that window, the gateway races a duplicate request
// and serves whichever answers first. The mock's TRIGGER_STALL_ONCE_<ms>
// stalls only the first request, so a served response arriving well before
// the stall elapses proves the hedge — not the primary — was served.
describe("upstream TTFB hedging", () => {
	const harness = createGatewayApiTestHarness();
	let mockServerUrl = "";

	const STALL_MS = 4000;
	const HEDGE_DELAY_MS = 250;

	beforeAll(() => {
		mockServerUrl = harness.mockServerUrl;
		process.env.UPSTREAM_HEDGE_DELAY_MS = String(HEDGE_DELAY_MS);
	});

	afterAll(() => {
		delete process.env.UPSTREAM_HEDGE_DELAY_MS;
	});

	beforeEach(() => {
		resetFailOnceCounter();
	});

	async function seedKeys(suffix: string) {
		await db.insert(tables.apiKey).values({
			id: `token-id-hedging-${suffix}`,
			token: `real-token-hedging-${suffix}`,
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: `provider-key-hedging-${suffix}`,
			token: "sk-openai-test-key",
			provider: "openai",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		return `real-token-hedging-${suffix}`;
	}

	test("streaming request stalled upstream is rescued by the hedge", async () => {
		const token = await seedKeys("stalled");

		const started = Date.now();
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({
				model: "openai/gpt-4o-mini",
				stream: true,
				messages: [
					{
						role: "user",
						content: `TRIGGER_STALL_ONCE_${STALL_MS} hedging rescue test`,
					},
				],
			}),
		});
		expect(res.status).toBe(200);

		const result = await readAll(res.body);
		const elapsed = Date.now() - started;

		expect(result.hasValidSSE).toBe(true);
		expect(result.hasContent).toBe(true);
		expect(result.hasError).toBe(false);
		// The hedge (second upstream request) must have been issued...
		expect(getStallOnceCounter()).toBe(2);
		// ...and served: finishing this far under the primary's stall is only
		// possible on the hedge branch. The margin absorbs slow CI runners.
		expect(elapsed).toBeLessThan(STALL_MS - 1000);
	});

	test("hedge is not issued when the primary responds in time", async () => {
		const token = await seedKeys("fast");

		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({
				model: "openai/gpt-4o-mini",
				stream: true,
				messages: [{ role: "user", content: "fast hedging test" }],
			}),
		});
		expect(res.status).toBe(200);

		const result = await readAll(res.body);
		expect(result.hasValidSSE).toBe(true);
		expect(result.hasError).toBe(false);
		expect(getStallOnceCounter()).toBe(0);
	});
});
