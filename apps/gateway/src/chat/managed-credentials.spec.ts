import { afterEach, describe, expect, test, vi } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";

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
	}) {
		await cdb.insert(tables.providerKey).values({
			id: values.id,
			provider: values.provider,
			token: values.token,
			managed: true,
			organizationId: null,
			config: values.config,
			variant: values.variant ?? "default",
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
});
