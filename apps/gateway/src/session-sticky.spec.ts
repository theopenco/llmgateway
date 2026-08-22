import { beforeAll, describe, expect, test } from "vitest";

import { redisClient } from "@llmgateway/cache";
import { db, tables } from "@llmgateway/db";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";

// Regression tests for https://github.com/theopenco/llmgateway/issues/3347:
// switching service tiers mid-session must not break session stickiness.
//
// gpt-5.5 is served by openai (the only mapping with serviceTiers) and azure.
// Azure has provider priority 2, so with equal prices it is always the natural
// routing winner — any request that lands on openai instead can only be
// explained by the session pin. A `service_tier: "priority"` request narrows
// the candidate list to just openai, which routes through the single-provider
// shortcut in chat.ts; that shortcut must keep the session pin in sync so a
// later request without the tier stays on openai instead of re-scoring to
// azure and cold-starting a different provider's prompt cache.
describe("session stickiness across candidate changes", () => {
	const harness = createGatewayApiTestHarness();
	let mockServerUrl = "";

	beforeAll(() => {
		mockServerUrl = harness.mockServerUrl;
	});

	const MODEL = "gpt-5.5";

	function sessionPinKey(sessionId: string, model = MODEL): string {
		return `session_provider:org-id:${model}:${sessionId}`;
	}

	async function readSessionPin(
		sessionId: string,
		model = MODEL,
	): Promise<{ providerId: string; region?: string } | null> {
		const raw = await redisClient.get(sessionPinKey(sessionId, model));
		return raw ? JSON.parse(raw) : null;
	}

	async function seedApiAndProviderKeys(suffix: string) {
		await db.insert(tables.apiKey).values({
			id: `token-id-session-sticky-${suffix}`,
			token: `real-token-session-sticky-${suffix}`,
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values([
			{
				id: `provider-key-session-sticky-openai-${suffix}`,
				token: "sk-openai-test-key",
				provider: "openai",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			},
			{
				id: `provider-key-session-sticky-azure-${suffix}`,
				token: "sk-azure-test-key",
				provider: "azure",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
				// Pin the deployment type so a developer's LLM_AZURE_DEPLOYMENT_TYPE
				// env value can't reroute the request off the mock server's
				// /openai/v1/* aliases.
				options: { azure_deployment_type: "ai-foundry" },
			},
		]);

		return `real-token-session-sticky-${suffix}`;
	}

	async function chatCompletion(
		token: string,
		body: Record<string, unknown>,
		headers: Record<string, string> = {},
	) {
		return await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
				...headers,
			},
			body: JSON.stringify(body),
		});
	}

	test("azure is the natural routing winner for the model without a session", async () => {
		// Control for the tests below: with equal prices, azure's provider
		// priority (2) makes it the deterministic first choice. If this ever
		// stops holding (catalog/priority change), the sticky assertions below
		// would become vacuous — this test flags that setup drift.
		const token = await seedApiAndProviderKeys("control");

		const res = await chatCompletion(token, {
			model: MODEL,
			messages: [{ role: "user", content: "control request" }],
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		const routing = json.metadata?.routing ?? [];
		expect(routing.length).toBeGreaterThan(0);
		// Azure must be attempted first; the mock upstream serves no azure
		// endpoint, so the request then falls back to openai — which is fine,
		// the control only cares about the first pick.
		expect(routing[0].provider).toBe("azure");
	});

	test("session started on priority tier stays on the tier provider after the tier is disabled", async () => {
		const token = await seedApiAndProviderKeys("tier-off");
		const sessionId = "session-priority-then-default";

		// 1. Priority request: the tier filter narrows candidates to openai
		// (the only tier-capable mapping), taking the single-provider shortcut.
		const priorityRes = await chatCompletion(
			token,
			{
				model: MODEL,
				service_tier: "priority",
				messages: [{ role: "user", content: "start of session" }],
			},
			{ "x-session-id": sessionId },
		);

		expect(priorityRes.status).toBe(200);
		const priorityJson = await priorityRes.json();
		expect(priorityJson.metadata?.used_provider).toBe("openai");
		expect(priorityJson.metadata?.used_service_tier).toBe("priority");

		// The shortcut must have pinned the session to openai.
		expect(await readSessionPin(sessionId)).toMatchObject({
			providerId: "openai",
		});
		const ttl = await redisClient.ttl(sessionPinKey(sessionId));
		expect(ttl).toBeGreaterThan(0);
		expect(ttl).toBeLessThanOrEqual(3600);

		// 2. Same session without the tier: azure is back in the candidate list
		// (and is the natural winner per the control test), but the session pin
		// must keep the request on openai so its prompt cache stays warm.
		const defaultRes = await chatCompletion(
			token,
			{
				model: MODEL,
				messages: [{ role: "user", content: "continuing the session" }],
			},
			{ "x-session-id": sessionId },
		);

		expect(defaultRes.status).toBe(200);
		const defaultJson = await defaultRes.json();
		expect(defaultJson.metadata?.used_provider).toBe("openai");
		// No attempt may have gone to azure — a fallback from a failed azure
		// attempt would also end on openai, which is exactly the bug.
		const attempts = defaultJson.metadata?.routing ?? [];
		for (const attempt of attempts) {
			expect(attempt.provider).toBe("openai");
		}

		// The pin survives (TTL refreshed by the sticky reuse).
		expect(await readSessionPin(sessionId)).toMatchObject({
			providerId: "openai",
		});
	});

	test("enabling the priority tier mid-session re-pins the session to the tier provider", async () => {
		const token = await seedApiAndProviderKeys("tier-on");
		const sessionId = "session-default-then-priority";

		// Session previously ran on azure (e.g. before the user enabled
		// priority). The tier request is forced onto openai, so the pin must
		// move with it — the session's cache is building on openai now.
		await redisClient.set(
			sessionPinKey(sessionId),
			JSON.stringify({ providerId: "azure" }),
			"EX",
			3600,
		);

		const priorityRes = await chatCompletion(
			token,
			{
				model: MODEL,
				service_tier: "priority",
				messages: [{ role: "user", content: "switching to priority" }],
			},
			{ "x-session-id": sessionId },
		);

		expect(priorityRes.status).toBe(200);
		const priorityJson = await priorityRes.json();
		expect(priorityJson.metadata?.used_provider).toBe("openai");
		expect(await readSessionPin(sessionId)).toMatchObject({
			providerId: "openai",
		});

		// Dropping the tier keeps the session on openai instead of bouncing
		// back to the stale azure pin.
		const defaultRes = await chatCompletion(
			token,
			{
				model: MODEL,
				messages: [{ role: "user", content: "back to default tier" }],
			},
			{ "x-session-id": sessionId },
		);

		expect(defaultRes.status).toBe(200);
		const defaultJson = await defaultRes.json();
		expect(defaultJson.metadata?.used_provider).toBe("openai");
		const attempts = defaultJson.metadata?.routing ?? [];
		for (const attempt of attempts) {
			expect(attempt.provider).toBe("openai");
		}
	});

	test("the single-provider shortcut writes no pin without a session id", async () => {
		const token = await seedApiAndProviderKeys("no-session");

		const res = await chatCompletion(token, {
			model: MODEL,
			service_tier: "priority",
			messages: [{ role: "user", content: "no session header" }],
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.metadata?.used_provider).toBe("openai");

		const [, keys] = await redisClient.scan(
			"0",
			"MATCH",
			"session_provider:*",
			"COUNT",
			1000,
		);
		expect(keys).toEqual([]);
	});

	test("tool-choice capability takes precedence over an existing session pin", async () => {
		const model = "deepseek-v4-flash";
		const sessionId = "session-tool-choice-precedence";
		const token = "real-token-session-sticky-tool-choice";

		await db.insert(tables.apiKey).values({
			id: "token-id-session-sticky-tool-choice",
			token,
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});
		await db.insert(tables.providerKey).values([
			{
				id: "provider-key-session-sticky-canopywave",
				token: "sk-canopywave-test-key",
				provider: "canopywave",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			},
			{
				id: "provider-key-session-sticky-deepinfra",
				token: "sk-deepinfra-test-key",
				provider: "deepinfra",
				organizationId: "org-id",
				baseUrl: `${mockServerUrl}/v1`,
			},
		]);
		await redisClient.set(
			sessionPinKey(sessionId, model),
			JSON.stringify({ providerId: "canopywave" }),
			"EX",
			3600,
		);

		const res = await chatCompletion(
			token,
			{
				model,
				messages: [{ role: "user", content: "Use the lookup tool" }],
				tools: [
					{
						type: "function",
						function: {
							name: "lookup",
							description: "Look up a value",
							parameters: { type: "object", properties: {} },
						},
					},
				],
				tool_choice: "required",
			},
			{ "x-session-id": sessionId },
		);

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.metadata?.used_provider).toBe("deepinfra");
		expect(await readSessionPin(sessionId, model)).toMatchObject({
			providerId: "deepinfra",
		});
	});
});
