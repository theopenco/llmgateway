import { afterEach, describe, expect, test, vi } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";
import { waitForLogs } from "@/test-utils/test-helpers.js";

import { cdb, db, eq, tables } from "@llmgateway/db";

/**
 * Credits-mode traffic served by platform-managed provider credentials — the
 * database-backed replacement for the `LLM_*` environment variables.
 */
describe("managed provider credentials", () => {
	const harness = createGatewayApiTestHarness();

	afterEach(() => {
		vi.restoreAllMocks();
	});

	async function seedApiKey() {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});
		await harness.setProjectMode("credits");
	}

	/**
	 * Written through cdb so the gateway's SWR mirror for provider_key is
	 * invalidated, exactly as the admin API writes it.
	 */
	async function seedManagedCredential(values: {
		id: string;
		provider: string;
		token: string;
		config?: Record<string, string>;
		variant?: "default" | "enterprise" | "plans";
		region?: string;
		allowedModels?: string[];
	}) {
		await cdb.insert(tables.providerKey).values({
			id: values.id,
			provider: values.provider,
			token: values.token,
			managed: true,
			organizationId: null,
			config: values.config,
			variant: values.variant ?? "default",
			region: values.region,
			allowedModels: values.allowedModels,
		});
	}

	interface CapturedRequest {
		url: string;
		authorization: string | null;
	}

	function captureUpstream(body: unknown): CapturedRequest[] {
		const captured: CapturedRequest[] = [];
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			const url =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.toString()
						: input.url;
			captured.push({
				url,
				authorization: new Headers(init?.headers).get("authorization"),
			});
			return new Response(JSON.stringify(body), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		});
		return captured;
	}

	const chatCompletion = {
		id: "chatcmpl-managed",
		object: "chat.completion",
		created: 1,
		model: "gpt-4o-mini",
		choices: [
			{
				index: 0,
				message: { role: "assistant", content: "Hello" },
				finish_reason: "stop",
			},
		],
		usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
	};

	async function completions(model: string) {
		return await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				Authorization: "Bearer real-token",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model,
				messages: [{ role: "user", content: "Hi" }],
			}),
		});
	}

	test("serves a credits-mode request with the credential's token and base URL", async () => {
		await seedApiKey();
		await seedManagedCredential({
			id: "managed-openai",
			provider: "openai",
			token: "sk-managed-openai",
			config: { baseUrl: "https://openai.managed.test" },
		});

		const previousEnvKey = process.env.LLM_OPENAI_API_KEY;
		process.env.LLM_OPENAI_API_KEY = "sk-from-env";
		const captured = captureUpstream(chatCompletion);

		try {
			const res = await completions("openai/gpt-4o-mini");
			expect(res.status).toBe(200);
		} finally {
			if (previousEnvKey === undefined) {
				delete process.env.LLM_OPENAI_API_KEY;
			} else {
				process.env.LLM_OPENAI_API_KEY = previousEnvKey;
			}
		}

		expect(captured).toHaveLength(1);
		expect(captured[0].url).toBe(
			"https://openai.managed.test/v1/chat/completions",
		);
		// The env var is set but ignored: the provider has a managed credential.
		expect(captured[0].authorization).toBe("Bearer sk-managed-openai");
	});

	test("makes the provider routable in credits mode with no env var set", async () => {
		await seedApiKey();
		await seedManagedCredential({
			id: "managed-openai-no-env",
			provider: "openai",
			token: "sk-managed-only",
		});

		const previousEnvKey = process.env.LLM_OPENAI_API_KEY;
		delete process.env.LLM_OPENAI_API_KEY;
		const captured = captureUpstream(chatCompletion);

		try {
			const res = await completions("openai/gpt-4o-mini");
			expect(res.status).toBe(200);
		} finally {
			if (previousEnvKey !== undefined) {
				process.env.LLM_OPENAI_API_KEY = previousEnvKey;
			}
		}

		expect(captured).toHaveLength(1);
		expect(captured[0].authorization).toBe("Bearer sk-managed-only");
	});

	test("falls back to the env var for providers with no managed credential", async () => {
		await seedApiKey();
		await seedManagedCredential({
			id: "managed-anthropic",
			provider: "anthropic",
			token: "sk-managed-anthropic",
		});

		const previousEnvKey = process.env.LLM_OPENAI_API_KEY;
		process.env.LLM_OPENAI_API_KEY = "sk-from-env";
		const captured = captureUpstream(chatCompletion);

		try {
			const res = await completions("openai/gpt-4o-mini");
			expect(res.status).toBe(200);
		} finally {
			if (previousEnvKey === undefined) {
				delete process.env.LLM_OPENAI_API_KEY;
			} else {
				process.env.LLM_OPENAI_API_KEY = previousEnvKey;
			}
		}

		expect(captured).toHaveLength(1);
		expect(captured[0].url).toBe("https://api.openai.com/v1/chat/completions");
		expect(captured[0].authorization).toBe("Bearer sk-from-env");
	});

	test("serves an enterprise org its enterprise credential over the env override", async () => {
		await seedApiKey();
		await db
			.update(tables.organization)
			.set({ plan: "enterprise" })
			.where(eq(tables.organization.id, "org-id"));
		await seedManagedCredential({
			id: "managed-shared",
			provider: "openai",
			token: "sk-managed-shared",
		});
		await seedManagedCredential({
			id: "managed-enterprise",
			provider: "openai",
			token: "sk-managed-enterprise",
			variant: "enterprise",
		});

		const previousEnvKey = process.env.LLM_OPENAI_API_KEY;
		const previousEnterpriseEnvKey = process.env.LLM_OPENAI_API_KEY__ENTERPRISE;
		process.env.LLM_OPENAI_API_KEY = "sk-from-env";
		process.env.LLM_OPENAI_API_KEY__ENTERPRISE = "sk-from-enterprise-env";
		const captured = captureUpstream(chatCompletion);

		try {
			const res = await completions("openai/gpt-4o-mini");
			expect(res.status).toBe(200);
		} finally {
			if (previousEnvKey === undefined) {
				delete process.env.LLM_OPENAI_API_KEY;
			} else {
				process.env.LLM_OPENAI_API_KEY = previousEnvKey;
			}
			if (previousEnterpriseEnvKey === undefined) {
				delete process.env.LLM_OPENAI_API_KEY__ENTERPRISE;
			} else {
				process.env.LLM_OPENAI_API_KEY__ENTERPRISE = previousEnterpriseEnvKey;
			}
		}

		expect(captured).toHaveLength(1);
		// The enterprise env override loses to the managed credential, and the
		// enterprise-variant credential wins over the shared one.
		expect(captured[0].authorization).toBe("Bearer sk-managed-enterprise");
	});

	test("serves an enterprise org the shared credential when it has no variant of its own", async () => {
		await seedApiKey();
		await db
			.update(tables.organization)
			.set({ plan: "enterprise" })
			.where(eq(tables.organization.id, "org-id"));
		await seedManagedCredential({
			id: "managed-shared-only",
			provider: "openai",
			token: "sk-managed-shared",
		});

		const previousEnterpriseEnvKey = process.env.LLM_OPENAI_API_KEY__ENTERPRISE;
		process.env.LLM_OPENAI_API_KEY__ENTERPRISE = "sk-from-enterprise-env";
		const captured = captureUpstream(chatCompletion);

		try {
			const res = await completions("openai/gpt-4o-mini");
			expect(res.status).toBe(200);
		} finally {
			if (previousEnterpriseEnvKey === undefined) {
				delete process.env.LLM_OPENAI_API_KEY__ENTERPRISE;
			} else {
				process.env.LLM_OPENAI_API_KEY__ENTERPRISE = previousEnterpriseEnvKey;
			}
		}

		expect(captured).toHaveLength(1);
		expect(captured[0].authorization).toBe("Bearer sk-managed-shared");
	});

	test("supplies the multi-setting credentials Google Vertex needs", async () => {
		await seedApiKey();
		await seedManagedCredential({
			id: "managed-vertex",
			provider: "google-vertex",
			token: "vertex-managed-key",
			config: {
				project: "managed-gcp-project",
				region: "us-central1",
				baseUrl: "https://vertex.managed.test",
			},
		});

		const previousProject = process.env.LLM_GOOGLE_CLOUD_PROJECT;
		const previousRegion = process.env.LLM_GOOGLE_VERTEX_REGION;
		const previousKey = process.env.LLM_GOOGLE_VERTEX_API_KEY;
		delete process.env.LLM_GOOGLE_CLOUD_PROJECT;
		delete process.env.LLM_GOOGLE_VERTEX_REGION;
		delete process.env.LLM_GOOGLE_VERTEX_API_KEY;

		const captured = captureUpstream({
			candidates: [
				{
					content: { parts: [{ text: "Hello" }], role: "model" },
					finishReason: "STOP",
				},
			],
			usageMetadata: {
				promptTokenCount: 1,
				candidatesTokenCount: 1,
				totalTokenCount: 2,
			},
		});

		try {
			const res = await completions("google-vertex/gemini-2.5-flash-lite");
			expect(res.status).toBe(200);
		} finally {
			if (previousProject !== undefined) {
				process.env.LLM_GOOGLE_CLOUD_PROJECT = previousProject;
			}
			if (previousRegion !== undefined) {
				process.env.LLM_GOOGLE_VERTEX_REGION = previousRegion;
			}
			if (previousKey !== undefined) {
				process.env.LLM_GOOGLE_VERTEX_API_KEY = previousKey;
			}
		}

		expect(captured).toHaveLength(1);
		expect(captured[0].url).toContain(
			"https://vertex.managed.test/v1/projects/",
		);
		expect(captured[0].url).toContain(
			"/projects/managed-gcp-project/locations/us-central1/",
		);
		expect(captured[0].url).toContain("key=vertex-managed-key");
	});

	/**
	 * A provider can hold several active managed credentials, so a failing one
	 * must be rotated away from rather than failing the request — the same
	 * alternate-key retry chat, embeddings, speech, transcriptions and OCR do.
	 */
	test("moderations rotates to another managed credential when one fails", async () => {
		await seedApiKey();
		await seedManagedCredential({
			id: "managed-openai-a",
			provider: "openai",
			token: "sk-managed-a",
		});
		await seedManagedCredential({
			id: "managed-openai-b",
			provider: "openai",
			token: "sk-managed-b",
		});

		const previousEnvKey = process.env.LLM_OPENAI_API_KEY;
		delete process.env.LLM_OPENAI_API_KEY;

		const seen: (string | null)[] = [];
		vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
			const authorization = new Headers(init?.headers).get("authorization");
			seen.push(authorization);
			// Whichever credential is tried first is rejected; the other works.
			if (seen.length === 1) {
				return new Response(
					JSON.stringify({ error: { message: "Invalid API key" } }),
					{ status: 401, headers: { "Content-Type": "application/json" } },
				);
			}
			return new Response(
				JSON.stringify({
					id: "modr-1",
					model: "omni-moderation-latest",
					results: [{ flagged: false }],
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		});

		try {
			const res = await app.request("/v1/moderations", {
				method: "POST",
				headers: {
					Authorization: "Bearer real-token",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ input: "hello" }),
			});
			expect(res.status).toBe(200);
		} finally {
			if (previousEnvKey !== undefined) {
				process.env.LLM_OPENAI_API_KEY = previousEnvKey;
			}
		}

		// Both credentials were tried, and they were different ones.
		expect(seen).toHaveLength(2);
		expect(new Set(seen).size).toBe(2);
		expect(new Set(seen)).toEqual(
			new Set(["Bearer sk-managed-a", "Bearer sk-managed-b"]),
		);
	});

	/**
	 * Managed credentials replace the provider's `LLM_*` variables instead of
	 * taking precedence over them: once the provider has one, the environment is
	 * out of play for routing and for every fallback. Rotating onto an env key
	 * after the managed fleet is exhausted would spend a credential the operator
	 * has already retired on the admin dashboard.
	 */
	test("never rotates onto an env key when the managed credentials fail", async () => {
		await seedApiKey();
		await seedManagedCredential({
			id: "managed-openai-lone",
			provider: "openai",
			token: "sk-managed-lone",
		});

		const previousEnvKey = process.env.LLM_OPENAI_API_KEY;
		process.env.LLM_OPENAI_API_KEY = "sk-from-env";

		const seen: (string | null)[] = [];
		vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
			seen.push(new Headers(init?.headers).get("authorization"));
			return new Response(
				JSON.stringify({ error: { message: "Invalid API key" } }),
				{ status: 401, headers: { "Content-Type": "application/json" } },
			);
		});

		try {
			await app.request("/v1/moderations", {
				method: "POST",
				headers: {
					Authorization: "Bearer real-token",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ input: "hello" }),
			});
		} finally {
			if (previousEnvKey === undefined) {
				delete process.env.LLM_OPENAI_API_KEY;
			} else {
				process.env.LLM_OPENAI_API_KEY = previousEnvKey;
			}
		}

		expect(seen).toEqual(["Bearer sk-managed-lone"]);
	});

	test("fails instead of using the env key when no managed credential may serve the model", async () => {
		await seedApiKey();
		await seedManagedCredential({
			id: "managed-openai-restricted",
			provider: "openai",
			token: "sk-managed-restricted",
			allowedModels: ["gpt-4o"],
		});

		const previousEnvKey = process.env.LLM_OPENAI_API_KEY;
		process.env.LLM_OPENAI_API_KEY = "sk-from-env";
		const captured = captureUpstream(chatCompletion);

		try {
			const res = await completions("openai/gpt-4o-mini");
			expect(res.status).not.toBe(200);
		} finally {
			if (previousEnvKey === undefined) {
				delete process.env.LLM_OPENAI_API_KEY;
			} else {
				process.env.LLM_OPENAI_API_KEY = previousEnvKey;
			}
		}

		expect(captured).toEqual([]);
	});

	/**
	 * A provider whose regions each have their own credential (Alibaba has no
	 * global region, so every managed credential is region-pinned) must still
	 * serve a request that never resolved a region — it is sent to the
	 * provider's default region, so the credential pinned to that region is the
	 * one that serves it. Falling through to "no managed credential" 500s every
	 * region-less request the moment the last region-agnostic credential goes
	 * away. Uses `qwen-omni-turbo`, whose mapping has no regional variants at
	 * all, so the request genuinely resolves no region — a model with regional
	 * variants routes over those instead (see the cheapest-region test below).
	 */
	test("serves a region-less request from the default-region credential", async () => {
		await seedApiKey();
		await seedManagedCredential({
			id: "managed-alibaba-singapore",
			provider: "alibaba",
			token: "sk-managed-singapore",
			region: "singapore",
		});
		await seedManagedCredential({
			id: "managed-alibaba-frankfurt",
			provider: "alibaba",
			token: "sk-managed-frankfurt",
			region: "eu-frankfurt",
		});

		const captured = captureUpstream(chatCompletion);

		// Bare model id: no provider prefix and no `:region` suffix.
		const res = await completions("qwen-omni-turbo");
		expect(res.status).toBe(200);

		expect(captured).toHaveLength(1);
		expect(captured[0].url).toContain("dashscope-intl.aliyuncs.com");
		expect(captured[0].authorization).toBe("Bearer sk-managed-singapore");
	});

	/**
	 * A bare model id must route over the provider's regional variants exactly
	 * like the `provider/model` spelling does: the credentialed regions are
	 * priced against each other and the cheapest one wins. The single-provider
	 * shortcut used to read the un-expanded mapping's `region: undefined` and
	 * send every such request to the default region, so `qwen3.7-plus` and
	 * `alibaba/qwen3.7-plus` — the same request, two spellings — picked
	 * different regions at different prices.
	 */
	test("routes a bare multi-region id to the cheapest eligible region", async () => {
		await seedApiKey();
		await seedManagedCredential({
			id: "managed-alibaba-singapore",
			provider: "alibaba",
			token: "sk-managed-singapore",
			region: "singapore",
		});
		await seedManagedCredential({
			id: "managed-alibaba-frankfurt",
			provider: "alibaba",
			token: "sk-managed-frankfurt",
			region: "eu-frankfurt",
		});

		const captured = captureUpstream(chatCompletion);

		// Frankfurt undercuts the mapping's (singapore) prices for this model.
		const res = await completions("qwen3.7-plus");
		expect(res.status).toBe(200);

		expect(captured).toHaveLength(1);
		expect(captured[0].url).toContain("eu-central-1.maas.aliyuncs.com");
		expect(captured[0].authorization).toBe("Bearer sk-managed-frankfurt");
	});

	test("serves each pinned region from its own credential", async () => {
		await seedApiKey();
		await seedManagedCredential({
			id: "managed-alibaba-singapore",
			provider: "alibaba",
			token: "sk-managed-singapore",
			region: "singapore",
		});
		await seedManagedCredential({
			id: "managed-alibaba-frankfurt",
			provider: "alibaba",
			token: "sk-managed-frankfurt",
			region: "eu-frankfurt",
		});

		const captured = captureUpstream(chatCompletion);

		const res = await completions("alibaba/qwen3.7-plus:eu-frankfurt");
		expect(res.status).toBe(200);

		expect(captured).toHaveLength(1);
		expect(captured[0].url).toContain("eu-central-1.maas.aliyuncs.com");
		expect(captured[0].authorization).toBe("Bearer sk-managed-frankfurt");
	});

	test("routes a PAYG org to a default credential alongside a variant one", async () => {
		await seedApiKey();
		await seedManagedCredential({
			id: "managed-openai-ent",
			provider: "openai",
			token: "sk-managed-enterprise",
			variant: "enterprise",
		});
		await seedManagedCredential({
			id: "managed-openai-def",
			provider: "openai",
			token: "sk-managed-default",
			variant: "default",
		});

		const previousEnvKey = process.env.LLM_OPENAI_API_KEY;
		delete process.env.LLM_OPENAI_API_KEY;
		const captured = captureUpstream(chatCompletion);

		try {
			const res = await completions("openai/gpt-4o-mini");
			expect(res.status).toBe(200);
		} finally {
			if (previousEnvKey !== undefined) {
				process.env.LLM_OPENAI_API_KEY = previousEnvKey;
			}
		}

		expect(captured).toHaveLength(1);
		expect(captured[0].authorization).toBe("Bearer sk-managed-default");
	});

	/**
	 * BILLING-CRITICAL. `usedMode` decides whether the worker charges the
	 * organization: `credits` deducts the full request cost, `api-keys` deducts
	 * only data storage (apps/worker/src/worker.ts). A managed credential is
	 * LLM Gateway's own key — the same role the `LLM_*` env vars played — so
	 * traffic it serves must bill exactly as it did before the migration. If
	 * this ever logs `api-keys`, LLM Gateway pays the provider and bills nobody.
	 */
	describe("usedMode billing attribution", () => {
		/**
		 * Also pins the attribution invariant: log.providerKeyId carries the
		 * managed credential id (for per-key spend limits) while usedMode stays
		 * "credits" — the managed id must never leak into the billing
		 * discriminator.
		 */
		async function expectCreditsLog(expectedProviderKeyId?: string) {
			const logs = await waitForLogs(1);
			expect(logs).toHaveLength(1);
			expect(logs[0].usedMode).toBe("credits");
			if (expectedProviderKeyId) {
				expect(logs[0].providerKeyId).toBe(expectedProviderKeyId);
			}
		}

		test("chat completions served by a managed credential bill as credits", async () => {
			await seedApiKey();
			await seedManagedCredential({
				id: "managed-openai-billing",
				provider: "openai",
				token: "sk-managed-billing",
			});

			const previousEnvKey = process.env.LLM_OPENAI_API_KEY;
			delete process.env.LLM_OPENAI_API_KEY;
			captureUpstream(chatCompletion);

			try {
				const res = await completions("openai/gpt-4o-mini");
				expect(res.status).toBe(200);
			} finally {
				if (previousEnvKey !== undefined) {
					process.env.LLM_OPENAI_API_KEY = previousEnvKey;
				}
			}

			await expectCreditsLog("managed-openai-billing");
		});

		test("embeddings served by a managed credential bill as credits", async () => {
			await seedApiKey();
			await seedManagedCredential({
				id: "managed-openai-embed",
				provider: "openai",
				token: "sk-managed-embed",
			});

			const previousEnvKey = process.env.LLM_OPENAI_API_KEY;
			delete process.env.LLM_OPENAI_API_KEY;
			captureUpstream({
				object: "list",
				model: "text-embedding-3-small",
				data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2] }],
				usage: { prompt_tokens: 1, total_tokens: 1 },
			});

			try {
				const res = await app.request("/v1/embeddings", {
					method: "POST",
					headers: {
						Authorization: "Bearer real-token",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						model: "openai/text-embedding-3-small",
						input: "hello",
					}),
				});
				expect(res.status).toBe(200);
			} finally {
				if (previousEnvKey !== undefined) {
					process.env.LLM_OPENAI_API_KEY = previousEnvKey;
				}
			}

			await expectCreditsLog("managed-openai-embed");
		});

		test("moderations served by a managed credential bill as credits", async () => {
			await seedApiKey();
			await seedManagedCredential({
				id: "managed-openai-moderation",
				provider: "openai",
				token: "sk-managed-moderation",
			});

			const previousEnvKey = process.env.LLM_OPENAI_API_KEY;
			delete process.env.LLM_OPENAI_API_KEY;
			captureUpstream({
				id: "modr-1",
				model: "omni-moderation-latest",
				results: [{ flagged: false }],
			});

			try {
				const res = await app.request("/v1/moderations", {
					method: "POST",
					headers: {
						Authorization: "Bearer real-token",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ input: "hello" }),
				});
				expect(res.status).toBe(200);
			} finally {
				if (previousEnvKey !== undefined) {
					process.env.LLM_OPENAI_API_KEY = previousEnvKey;
				}
			}

			await expectCreditsLog("managed-openai-moderation");
		});

		test("rerank served by a managed credential bills as credits", async () => {
			await seedApiKey();
			await seedManagedCredential({
				id: "managed-deepinfra-rerank",
				provider: "deepinfra",
				token: "sk-managed-rerank",
			});

			const previousEnvKey = process.env.LLM_DEEPINFRA_API_KEY;
			delete process.env.LLM_DEEPINFRA_API_KEY;
			const captured = captureUpstream({
				scores: [0.9, 0.1],
				input_tokens: 5,
			});

			try {
				const res = await app.request("/v1/rerank", {
					method: "POST",
					headers: {
						Authorization: "Bearer real-token",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						model: "deepinfra/qwen3-reranker-8b",
						query: "what is a gateway",
						documents: ["a gateway routes requests", "a cat sleeps"],
					}),
				});
				expect(res.status).toBe(200);
			} finally {
				if (previousEnvKey !== undefined) {
					process.env.LLM_DEEPINFRA_API_KEY = previousEnvKey;
				}
			}

			expect(captured).toHaveLength(1);
			expect(captured[0].authorization).toBe("Bearer sk-managed-rerank");
			await expectCreditsLog("managed-deepinfra-rerank");
		});

		test("BYOK requests attribute the org key while billing as api-keys", async () => {
			await seedApiKey();
			await harness.setProjectMode("api-keys");
			await cdb.insert(tables.providerKey).values({
				id: "byok-openai-attribution",
				provider: "openai",
				token: "sk-byok-attribution",
				organizationId: "org-id",
			});

			const captured = captureUpstream(chatCompletion);

			const res = await completions("openai/gpt-4o-mini");
			expect(res.status).toBe(200);

			expect(captured).toHaveLength(1);
			expect(captured[0].authorization).toBe("Bearer sk-byok-attribution");

			const logs = await waitForLogs(1);
			expect(logs).toHaveLength(1);
			expect(logs[0].usedMode).toBe("api-keys");
			expect(logs[0].providerKeyId).toBe("byok-openai-attribution");
		});
	});
});
