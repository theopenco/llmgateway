import { beforeEach, describe, expect, test } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";

import { db, eq, sql, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

describe("existing organization policy endpoint defaults", () => {
	const harness = createGatewayApiTestHarness();
	const headers = {
		Authorization: "Bearer legacy-compat-token",
		"Content-Type": "application/json",
	};
	beforeEach(async () => {
		await harness.setProjectMode("credits");
		await db
			.update(tables.organization)
			.set({
				plan: "enterprise",
				providerCompliancePolicy: {
					enabled: true,
					allowedProviders: ["custom:private"],
				},
			})
			.where(eq(tables.organization.id, "org-id"));
		await db.insert(tables.apiKey).values({
			id: "legacy-compat-key",
			...hashApiKeyForStorage("legacy-compat-token"),
			projectId: "project-id",
			createdBy: "user-id",
			description: "Legacy compatibility fixture",
		});
	});
	test("existing-style inserts default to NULL and do not touch organization settings", async () => {
		const key = await db.query.apiKey.findFirst({
			where: { id: "legacy-compat-key" },
		});
		expect(key?.providerCompliancePolicy).toBeNull();
		const metadata = await db.execute<{
			is_nullable: string;
			column_default: string | null;
		}>(
			sql`SELECT is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'api_key' AND column_name = 'provider_compliance_policy'`,
		);
		expect(metadata.rows[0]).toEqual({
			is_nullable: "YES",
			column_default: null,
		});
		const org = await db.query.organization.findFirst({
			where: { id: "org-id" },
		});
		expect(org?.providerCompliancePolicy).toEqual({
			enabled: true,
			allowedProviders: ["custom:private"],
		});
		expect(org?.retentionLevel).toBe("retain");
	});

	test.each([
		[
			"/v1/chat/completions",
			{
				model: "openai/gpt-4o-mini",
				messages: [{ role: "user", content: "Legacy organization policy" }],
			},
		],
		[
			"/v1/messages",
			{
				model: "openai/gpt-4o-mini",
				max_tokens: 10,
				messages: [{ role: "user", content: "Legacy organization policy" }],
			},
		],
		[
			"/v1/responses",
			{
				model: "gpt-4o-mini",
				input: "Legacy organization policy",
				store: false,
			},
		],
		[
			"/v1/embeddings",
			{ model: "text-embedding-3-small", input: "Legacy organization policy" },
		],
		[
			"/v1/moderations",
			{ model: "omni-moderation-latest", input: "Legacy organization policy" },
		],
		[
			"/v1/images/generations",
			{ model: "gpt-image-2", prompt: "Legacy organization policy" },
		],
		[
			"/v1/audio/speech",
			{
				model: "gemini-2.5-flash-preview-tts",
				input: "Legacy organization policy",
				voice: "Kore",
			},
		],
		[
			"/v1/ocr",
			{
				model: "mistral-ocr-latest",
				document: {
					type: "image_url",
					image_url: "https://example.com/test.png",
				},
			},
		],
		[
			"/v1/rerank",
			{
				model: "qwen3-reranker-0.6b",
				query: "Legacy organization policy",
				documents: ["document"],
			},
		],
		[
			"/v1/search",
			{ model: "perplexity-search", query: "Legacy organization policy" },
		],
		[
			"/v1/videos",
			{
				model: "atlascloud/kling-v3-0",
				prompt: "Legacy organization policy",
				size: "1280x720",
				seconds: 5,
			},
		],
	] as const)(
		"%s keeps organization restrictions for default and disabled key settings",
		async (path, body) => {
			for (const policy of [
				null,
				{ enabled: false },
				{ enabled: false, allowedProviders: ["openai"] },
			]) {
				await db
					.update(tables.apiKey)
					.set({ providerCompliancePolicy: policy })
					.where(eq(tables.apiKey.id, "legacy-compat-key"));
				const response = await app.request(path, {
					method: "POST",
					headers,
					body: JSON.stringify(body),
				});
				expect(response.status, await response.text()).toBe(403);
			}
		},
	);

	test.each([
		null,
		{ enabled: false },
		{ enabled: false, zeroDataRetention: false },
	])("organization ZDR remains mandatory with key state %j", async (policy) => {
		await db
			.update(tables.organization)
			.set({
				providerCompliancePolicy: { enabled: true, zeroDataRetention: true },
			})
			.where(eq(tables.organization.id, "org-id"));
		await db
			.update(tables.apiKey)
			.set({ providerCompliancePolicy: policy })
			.where(eq(tables.apiKey.id, "legacy-compat-key"));
		for (const [path, body] of [
			["/v1/responses", { model: "gpt-4o-mini", input: "Never store this" }],
			[
				"/v1/videos",
				{
					model: "atlascloud/kling-v3-0",
					prompt: "Never store this",
					size: "1280x720",
					seconds: 5,
				},
			],
		] as const) {
			const response = await app.request(path, {
				method: "POST",
				headers,
				body: JSON.stringify(body),
			});
			expect(response.status, await response.text()).toBe(400);
		}
	});

	test("model discovery still honors an existing org model/provider allowlist", async () => {
		await db
			.update(tables.organization)
			.set({
				providerCompliancePolicy: {
					enabled: true,
					allowedModels: ["gpt-4o-mini"],
					allowedProviders: ["openai"],
				},
			})
			.where(eq(tables.organization.id, "org-id"));
		const response = await app.request("/v1/models", { headers });
		expect(response.status).toBe(200);
		const result = await response.json();
		expect(result.data.map((model: { id: string }) => model.id)).toEqual([
			"gpt-4o-mini",
		]);
		expect(
			result.data[0].providers.map(
				(provider: { providerId: string }) => provider.providerId,
			),
		).toEqual(["openai"]);
	});
});
