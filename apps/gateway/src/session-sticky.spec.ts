import { beforeAll, describe, expect, test, vi } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { redisClient } from "@llmgateway/cache";
import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import { resetFailOnceCounter } from "./test-utils/mock-openai-server.js";

// Regression tests for https://github.com/theopenco/llmgateway/issues/3347:
// switching service tiers mid-session must not break session stickiness.
//
// gpt-5.5 is served by openai and azure. Azure has provider priority 2, so with
// equal prices it is always the natural routing winner — any request that lands
// on openai instead can only be explained by the session pin. Azure sells
// Priority processing but no Flex tier, so a `service_tier: "flex"` request
// narrows the candidate list to just openai, which routes through the
// single-provider shortcut in chat.ts; that shortcut must keep the session pin
// in sync so a later request without the tier stays on openai instead of
// re-scoring to azure and cold-starting a different provider's prompt cache.
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
			...hashApiKeyForStorage(`real-token-session-sticky-${suffix}`),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values([
			{
				id: `provider-key-session-sticky-openai-${suffix}`,
				...encryptProviderKeyForStorage(
					"sk-openai-test-key",
					`provider-key-session-sticky-openai-${suffix}`,
					"org-id",
				),
				provider: "openai",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			},
			{
				id: `provider-key-session-sticky-azure-${suffix}`,
				...encryptProviderKeyForStorage(
					"sk-azure-test-key",
					`provider-key-session-sticky-azure-${suffix}`,
					"org-id",
				),
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

	test("session started on flex tier stays on the tier provider after the tier is disabled", async () => {
		const token = await seedApiAndProviderKeys("tier-off");
		const sessionId = "session-flex-then-default";

		// 1. Flex request: the tier filter narrows candidates to openai
		// (the only flex-capable mapping), taking the single-provider shortcut.
		const flexRes = await chatCompletion(
			token,
			{
				model: MODEL,
				service_tier: "flex",
				messages: [{ role: "user", content: "start of session" }],
			},
			{ "x-session-id": sessionId },
		);

		expect(flexRes.status).toBe(200);
		const flexJson = await flexRes.json();
		expect(flexJson.metadata?.used_provider).toBe("openai");
		expect(flexJson.metadata?.used_service_tier).toBe("flex");

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

	test("enabling the flex tier mid-session re-pins the session to the tier provider", async () => {
		const token = await seedApiAndProviderKeys("tier-on");
		const sessionId = "session-default-then-flex";

		// Session previously ran on azure (e.g. before the user enabled
		// flex). The tier request is forced onto openai, so the pin must
		// move with it — the session's cache is building on openai now.
		await redisClient.set(
			sessionPinKey(sessionId),
			JSON.stringify({ providerId: "azure" }),
			"EX",
			3600,
		);

		const flexRes = await chatCompletion(
			token,
			{
				model: MODEL,
				service_tier: "flex",
				messages: [{ role: "user", content: "switching to flex" }],
			},
			{ "x-session-id": sessionId },
		);

		expect(flexRes.status).toBe(200);
		const flexJson = await flexRes.json();
		expect(flexJson.metadata?.used_provider).toBe("openai");
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
			service_tier: "flex",
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
			...hashApiKeyForStorage(token),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});
		await db.insert(tables.providerKey).values([
			{
				id: "provider-key-session-sticky-canopywave",
				...encryptProviderKeyForStorage(
					"sk-canopywave-test-key",
					"provider-key-session-sticky-canopywave",
					"org-id",
				),
				provider: "canopywave",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			},
			{
				id: "provider-key-session-sticky-deepinfra",
				...encryptProviderKeyForStorage(
					"sk-deepinfra-test-key",
					"provider-key-session-sticky-deepinfra",
					"org-id",
				),
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

	// A soft rate limit routes new traffic away from the capped provider but
	// keeps a session already pinned to it. The pin is on openai while azure is
	// the natural winner, so a first attempt on azure means the pin was dropped.
	describe("soft rate limits", () => {
		const rpmKey = "rate_limit:provider_cap:rpm:org-id:openai:gpt-5.5";
		const rpdKey = "rate_limit:provider_cap:rpd:org-id:openai:gpt-5.5";

		async function capOpenai(mode: "strict" | "soft" | "lax") {
			await db.insert(tables.rateLimit).values({
				id: `rate-limit-openai-${mode}`,
				organizationId: "org-id",
				provider: "openai",
				model: MODEL,
				maxRpm: 1,
				mode,
			});
			// Fill the only slot so the cap is already reached.
			await redisClient.zadd(rpmKey, Date.now(), "seed");
		}

		async function pinToOpenai(sessionId: string) {
			await redisClient.set(
				sessionPinKey(sessionId),
				JSON.stringify({ providerId: "openai" }),
				"EX",
				3600,
			);
		}

		async function send(token: string, sessionId?: string) {
			const res = await chatCompletion(
				token,
				{ model: MODEL, messages: [{ role: "user", content: "hello" }] },
				sessionId ? { "x-session-id": sessionId } : {},
			);
			const json = await res.json();
			return {
				status: res.status,
				firstProvider: json.metadata?.routing?.[0]?.provider as
					string | undefined,
				usedProvider: json.metadata?.used_provider as string | undefined,
			};
		}

		test.each(["soft", "lax"] as const)(
			"a pinned session stays on a %s-capped provider and still counts",
			async (mode) => {
				const token = await seedApiAndProviderKeys("soft-pinned");
				const sessionId = "session-soft-pinned";
				await capOpenai(mode);
				await pinToOpenai(sessionId);

				const result = await send(token, sessionId);

				expect(result.status).toBe(200);
				expect(result.firstProvider).toBe("openai");
				expect(result.usedProvider).toBe("openai");
				expect(await readSessionPin(sessionId)).toMatchObject({
					providerId: "openai",
				});
				// Counted past the cap of 1, so new sessions keep being routed away.
				expect(await redisClient.zcard(rpmKey)).toBe(2);
			},
		);

		test.each(["soft", "lax"] as const)(
			"a new session is routed away from a %s-capped provider",
			async (mode) => {
				const token = await seedApiAndProviderKeys("soft-new");
				const sessionId = "session-soft-new";
				await capOpenai(mode);

				const result = await send(token, sessionId);

				expect(result.firstProvider).toBe("azure");
				expect(await readSessionPin(sessionId)).toMatchObject({
					providerId: "azure",
				});
				expect(await redisClient.zcard(rpmKey)).toBe(1);
			},
		);

		test.each(["soft", "lax"] as const)(
			"a request without a session is routed away from a %s-capped provider",
			async (mode) => {
				const token = await seedApiAndProviderKeys("soft-no-session");
				await capOpenai(mode);

				const result = await send(token);

				expect(result.firstProvider).toBe("azure");
				expect(await redisClient.zcard(rpmKey)).toBe(1);
			},
		);

		test.each([
			["org", "rpm", false],
			["org", "rpd", true],
			["global", "rpm", true],
			["global", "rpd", false],
			["shared", "rpm", false],
			["shared", "rpd", true],
		] as const)(
			"lax explicit requests bypass %s %s (stream=%s)",
			async (scope, window, stream) => {
				const token = await seedApiAndProviderKeys("lax-explicit");
				await db.insert(tables.rateLimit).values({
					id: "lax-explicit",
					organizationId: scope === "org" ? "org-id" : null,
					provider: "openai",
					model: MODEL,
					mode: "lax",
					enforcement: scope === "shared" ? "global" : "per_org",
					...(window === "rpm" ? { maxRpm: 1 } : { maxRpd: 1 }),
				});
				const key = `rate_limit:provider_cap:${window}:${scope === "shared" ? "__global__" : "org-id"}:openai:${MODEL}`;
				await redisClient.zadd(key, Date.now(), "seed");
				for (const sessionId of [undefined, "lax-new-session"]) {
					const res = await chatCompletion(
						token,
						{
							model: `openai/${MODEL}`,
							stream,
							messages: [
								{ role: "user", content: `lax ${sessionId ?? "no-session"}` },
							],
						},
						{
							"x-no-fallback": "true",
							...(sessionId ? { "x-session-id": sessionId } : {}),
						},
					);
					expect(res.status).toBe(200);
					await res.text();
				}
				expect(await redisClient.zcard(key)).toBe(3);
				expect(await readSessionPin("lax-new-session")).toMatchObject({
					providerId: "openai",
				});
			},
		);

		test.each([false, true])(
			"all lax candidates capped returns 429 (stream=%s)",
			async (stream) => {
				const token = await seedApiAndProviderKeys("lax-all");
				await capOpenai("lax");
				await db.insert(tables.rateLimit).values({
					id: "lax-azure",
					organizationId: "org-id",
					provider: "azure",
					model: MODEL,
					maxRpm: 1,
					mode: "lax",
				});
				await redisClient.zadd(
					`rate_limit:provider_cap:rpm:org-id:azure:${MODEL}`,
					Date.now(),
					"seed",
				);
				const res = await chatCompletion(
					token,
					{
						model: MODEL,
						stream,
						messages: [{ role: "user", content: "all lax capped" }],
					},
					{ "x-session-id": "lax-all-new" },
				);
				expect(res.status).toBe(429);
				expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
				expect(await redisClient.zcard(rpmKey)).toBe(1);
			},
		);

		test("the single-provider shortcut cannot create a lax exemption", async () => {
			const token = await seedApiAndProviderKeys("lax-single");
			await capOpenai("lax");
			const res = await chatCompletion(
				token,
				{
					model: MODEL,
					service_tier: "flex",
					messages: [{ role: "user", content: "single lax" }],
				},
				{ "x-session-id": "lax-single-new" },
			);
			expect(res.status).toBe(429);
			expect(await redisClient.zcard(rpmKey)).toBe(1);
			expect(await readSessionPin("lax-single-new")).toBeNull();
		});

		test.each([false, true])(
			"fallback cannot enter a lax-capped provider (stream=%s)",
			async (stream) => {
				const token = await seedApiAndProviderKeys("lax-fallback");
				await capOpenai("lax");
				const res = await chatCompletion(token, {
					model: `azure/${MODEL}`,
					stream,
					messages: [{ role: "user", content: "TRIGGER_ERROR lax-fallback" }],
				});
				const body = await res.text();
				expect(res.status === 500 || body.includes("error")).toBe(true);
				expect(await redisClient.zcard(rpmKey)).toBe(1);
			},
		);

		test.each([false, true])(
			"lax explicit requests retain their exemption when rotating keys (stream=%s)",
			async (stream) => {
				resetFailOnceCounter();
				const token = await seedApiAndProviderKeys("lax-retry");
				await capOpenai("lax");
				await db.insert(tables.providerKey).values({
					id: "lax-retry-key",
					...encryptProviderKeyForStorage(
						["sk", "lax", "retry"].join("_"),
						"lax-retry-key",
						"org-id",
					),
					provider: "openai",
					organizationId: "org-id",
					baseUrl: mockServerUrl,
				});
				const res = await chatCompletion(
					token,
					{
						model: `openai/${MODEL}`,
						stream,
						messages: [
							{ role: "user", content: "TRIGGER_FAIL_ONCE lax-retry" },
						],
					},
					{ "x-no-fallback": "true" },
				);
				expect(res.status).toBe(200);
				const body = await res.text();
				expect(body).not.toContain("Temporary server error");
				expect(await redisClient.zcard(rpmKey)).toBe(3);
			},
		);

		test("a cap reached after selection cannot use the newly created session pin", async () => {
			const token = await seedApiAndProviderKeys("lax-race");
			await db.insert(tables.rateLimit).values({
				id: "lax-race",
				organizationId: "org-id",
				provider: "azure",
				model: MODEL,
				maxRpm: 1,
				mode: "lax",
			});
			const key = `rate_limit:provider_cap:rpm:org-id:azure:${MODEL}`;
			const original = redisClient.zcard.bind(redisClient);
			let filled = false;
			const spy = vi
				.spyOn(redisClient, "zcard")
				.mockImplementation(async (...args) => {
					const count = await original(...args);
					if (args[0] === key && !filled) {
						filled = true;
						await redisClient.zadd(key, Date.now(), "concurrent-request");
					}
					return count;
				});
			try {
				const result = await send(token, "lax-race-new");
				expect(result.status).toBe(429);
				expect(await redisClient.zcard(key)).toBe(1);
			} finally {
				spy.mockRestore();
			}
		});

		test("a strict cap still re-pins a pinned session", async () => {
			const token = await seedApiAndProviderKeys("strict-pinned");
			const sessionId = "session-strict-pinned";
			await capOpenai("strict");
			await pinToOpenai(sessionId);

			const result = await send(token, sessionId);

			expect(result.firstProvider).toBe("azure");
			expect(await readSessionPin(sessionId)).toMatchObject({
				providerId: "azure",
			});
			expect(await redisClient.zcard(rpmKey)).toBe(1);
		});

		describe("explicitly requested provider", () => {
			const MULTI_REGION_MODEL = "qwen-plus";
			const alibabaRpmKey = `rate_limit:provider_cap:rpm:org-id:alibaba:${MULTI_REGION_MODEL}`;

			async function seedAlibaba() {
				await db.insert(tables.apiKey).values({
					id: "token-id-soft-explicit",
					...hashApiKeyForStorage("real-token-soft-explicit"),
					projectId: "project-id",
					description: "Test API Key",
					createdBy: "user-id",
				});
				await db.insert(tables.providerKey).values({
					id: "provider-key-soft-explicit",
					...encryptProviderKeyForStorage(
						"sk-alibaba-test-key",
						"provider-key-soft-explicit",
						"org-id",
					),
					provider: "alibaba",
					organizationId: "org-id",
					baseUrl: mockServerUrl,
				});
				await db.insert(tables.rateLimit).values({
					id: "rate-limit-alibaba-soft",
					organizationId: "org-id",
					provider: "alibaba",
					model: MULTI_REGION_MODEL,
					maxRpm: 1,
					mode: "soft",
				});
				return "real-token-soft-explicit";
			}

			async function sendExplicit(token: string, sessionId: string) {
				const res = await chatCompletion(
					token,
					{
						model: `alibaba/${MULTI_REGION_MODEL}`,
						messages: [{ role: "user", content: `hello ${sessionId}` }],
					},
					{ "x-session-id": sessionId, "x-no-fallback": "true" },
				);
				return res.status;
			}

			test("a new session is blocked even when region selection pins it", async () => {
				const token = await seedAlibaba();
				await redisClient.zadd(alibabaRpmKey, Date.now(), "seed");

				expect(await sendExplicit(token, "session-explicit-new")).toBe(429);
				expect(await redisClient.zcard(alibabaRpmKey)).toBe(1);
			});

			test("an ongoing session keeps the provider past the cap", async () => {
				const token = await seedAlibaba();
				const sessionId = "session-explicit-ongoing";

				// Takes the only slot and pins the session.
				expect(await sendExplicit(token, sessionId)).toBe(200);
				expect(
					await readSessionPin(sessionId, MULTI_REGION_MODEL),
				).toMatchObject({ providerId: "alibaba" });

				expect(await sendExplicit(token, sessionId)).toBe(200);
				expect(await redisClient.zcard(alibabaRpmKey)).toBe(2);

				expect(await sendExplicit(token, "session-explicit-other")).toBe(429);
			});

			test("an ongoing session on a single-mapping provider keeps it", async () => {
				const token = await seedApiAndProviderKeys("soft-explicit-single");
				const sessionId = "session-explicit-single";
				await db.insert(tables.rateLimit).values({
					id: "rate-limit-openai-soft-explicit",
					organizationId: "org-id",
					provider: "openai",
					model: MODEL,
					maxRpm: 1,
					mode: "soft",
				});
				const sendOpenai = async (session: string) =>
					(
						await chatCompletion(
							token,
							{
								model: `openai/${MODEL}`,
								messages: [{ role: "user", content: `hello ${session}` }],
							},
							{ "x-session-id": session, "x-no-fallback": "true" },
						)
					).status;

				expect(await sendOpenai(sessionId)).toBe(200);
				expect(await sendOpenai(sessionId)).toBe(200);
				expect(await redisClient.zcard(rpmKey)).toBe(2);
				expect(await sendOpenai("session-explicit-single-other")).toBe(429);
			});
		});

		test("a strict window exceeded alongside a soft one re-pins the session", async () => {
			const token = await seedApiAndProviderKeys("mixed-pinned");
			const sessionId = "session-mixed-pinned";
			await capOpenai("soft");
			// Strict RPD from a broader row; RPM and RPD resolve independently.
			await db.insert(tables.rateLimit).values({
				id: "rate-limit-openai-strict-rpd",
				organizationId: "org-id",
				provider: "openai",
				model: null,
				maxRpd: 1,
			});
			await redisClient.zadd(rpdKey, Date.now(), "seed");
			await pinToOpenai(sessionId);

			const result = await send(token, sessionId);

			expect(result.firstProvider).toBe("azure");
			expect(await readSessionPin(sessionId)).toMatchObject({
				providerId: "azure",
			});
		});
	});
});
