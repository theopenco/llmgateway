import { describe, expect, test, vi } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { redisClient } from "@llmgateway/cache";
import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";

describe("token and provider key rate limits", () => {
	const harness = createGatewayApiTestHarness();
	const TOKEN = "real-token-token-rate-limits";
	const MODEL = "gpt-4o-mini";

	async function seedApiKey() {
		await db.insert(tables.apiKey).values({
			id: "token-id-token-rate-limits",
			...hashApiKeyForStorage(TOKEN),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});
	}

	async function seedOpenAiKey(
		id: string,
		limits: Partial<
			Record<"maxRpm" | "maxRpd" | "maxTpm" | "maxTpd", number>
		> = {},
		sortOrder?: number,
	) {
		await db.insert(tables.providerKey).values({
			id,
			...encryptProviderKeyForStorage("sk-openai-test-key", id, "org-id"),
			provider: "openai",
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
			sortOrder,
			...limits,
		});
	}

	async function chatCompletion() {
		return await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${TOKEN}`,
				// A capped explicit provider is otherwise served as the only option.
				"X-No-Fallback": "true",
			},
			body: JSON.stringify({
				model: `openai/${MODEL}`,
				messages: [{ role: "user", content: "Hello" }],
			}),
		});
	}

	test("rejects once the provider TPM cap is used up", async () => {
		await seedApiKey();
		await seedOpenAiKey("provider-key-trl-tpm");
		await db.insert(tables.rateLimit).values({
			organizationId: "org-id",
			provider: "openai",
			model: MODEL,
			maxTpm: 1,
		});

		const first = await chatCompletion();
		expect(first.status).toBe(200);

		// Tokens are recorded when the request is logged.
		await vi.waitFor(
			async () => {
				expect(
					await redisClient.exists(
						`rate_limit:provider_cap:tpm:org-id:openai:${MODEL}`,
					),
				).toBe(1);
			},
			{ timeout: 5000 },
		);

		const second = await chatCompletion();
		expect(second.status).toBe(429);
		expect(await second.text()).toContain("tokens per minute");
	});

	test("rotates past a provider key at its own RPM cap", async () => {
		await seedApiKey();
		await seedOpenAiKey("provider-key-trl-primary", { maxRpm: 1 }, 0);
		await seedOpenAiKey("provider-key-trl-secondary", { maxRpm: 100 }, 1);

		expect((await chatCompletion()).status).toBe(200);
		await vi.waitFor(
			async () => {
				expect(
					await redisClient.zcard(
						"rate_limit:provider_key:rpm:provider-key-trl-primary",
					),
				).toBe(1);
			},
			{ timeout: 5000 },
		);

		expect((await chatCompletion()).status).toBe(200);
		await vi.waitFor(
			async () => {
				expect(
					await redisClient.zcard(
						"rate_limit:provider_key:rpm:provider-key-trl-secondary",
					),
				).toBe(1);
			},
			{ timeout: 5000 },
		);
		expect(
			await redisClient.zcard(
				"rate_limit:provider_key:rpm:provider-key-trl-primary",
			),
		).toBe(1);
	});

	test("returns 429 when every provider key is at its cap", async () => {
		await seedApiKey();
		await seedOpenAiKey("provider-key-trl-only", { maxTpd: 1 });

		expect((await chatCompletion()).status).toBe(200);
		await vi.waitFor(
			async () => {
				expect(
					await redisClient.exists(
						"rate_limit:provider_key:tpd:provider-key-trl-only",
					),
				).toBe(1);
			},
			{ timeout: 5000 },
		);

		const res = await chatCompletion();
		expect(res.status).toBe(429);
		expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
		expect(await res.text()).toContain("configured rate limit");
	});
});
