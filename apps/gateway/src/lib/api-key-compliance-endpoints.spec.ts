import { beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

const headers = {
	Authorization: "Bearer test-token",
	"Content-Type": "application/json",
};
const blockedRequests: [string, Record<string, unknown>][] = [
	[
		"/v1/chat/completions",
		{
			model: "openai/gpt-4o-mini",
			messages: [{ role: "user", content: "Policy regression" }],
		},
	],
	[
		"/v1/messages",
		{
			model: "openai/gpt-4o-mini",
			max_tokens: 10,
			messages: [{ role: "user", content: "Policy regression" }],
		},
	],
	[
		"/v1/responses",
		{
			model: "openai/gpt-4o-mini",
			input: "Policy regression",
			store: false,
		},
	],
	[
		"/v1/images/generations",
		{
			model: "gpt-image-2",
			prompt: "Policy regression",
		},
	],
	[
		"/v1/embeddings",
		{ model: "text-embedding-3-small", input: "Policy regression" },
	],
	[
		"/v1/moderations",
		{ model: "omni-moderation-latest", input: "Policy regression" },
	],
	[
		"/v1/audio/speech",
		{
			model: "gemini-2.5-flash-preview-tts",
			input: "Policy regression",
			voice: "Kore",
		},
	],
	[
		"/v1/ocr",
		{
			model: "mistral-ocr-latest",
			document: {
				type: "image_url",
				image_url: "https://example.com/PAGES_3.png",
			},
		},
	],
	[
		"/v1/rerank",
		{
			model: "qwen3-reranker-0.6b",
			query: "Policy regression",
			documents: ["first document", "second document"],
		},
	],
	["/v1/search", { model: "perplexity-search", query: "Policy regression" }],
	[
		"/v1/decisions",
		{
			model: "jev",
			input: "Policy regression",
			questions: [
				{ type: "predicate", name: "urgent", instructions: "Is it urgent?" },
			],
		},
	],
	[
		"/v1/videos",
		{
			model: "atlascloud/kling-v3-0",
			prompt: "Policy regression",
			size: "1280x720",
			seconds: 5,
		},
	],
];

describe("API key compliance endpoint enforcement", () => {
	const harness = createGatewayApiTestHarness();

	beforeEach(async () => {
		await harness.setProjectMode("credits");
		await db.insert(tables.apiKey).values({
			id: "compliance-key",
			...hashApiKeyForStorage("test-token"),
			projectId: "project-id",
			createdBy: "user-id",
			description: "Compliance regression key",
			providerCompliancePolicy: {
				enabled: true,
				allowedProviders: ["custom:blocked"],
			},
		});
	});

	test.each(blockedRequests)(
		"%s enforces key policy without an org policy",
		async (path, body) => {
			const response = await app.request(path, {
				method: "POST",
				headers,
				body: JSON.stringify(body),
			});
			expect(response.status, await response.text()).toBe(403);
		},
	);

	test.each(["organization", "apiKey"])(
		"%s policy cannot be weakened by the other policy",
		async (scope) => {
			const blocked = { enabled: true, blockedProviders: ["openai"] };
			const allowed = { enabled: true, allowedProviders: ["openai"] };
			await db
				.update(tables.organization)
				.set({
					providerCompliancePolicy:
						scope === "organization" ? blocked : allowed,
				})
				.where(eq(tables.organization.id, "org-id"));
			await db
				.update(tables.apiKey)
				.set({
					providerCompliancePolicy: scope === "apiKey" ? blocked : allowed,
				})
				.where(eq(tables.apiKey.id, "compliance-key"));
			const response = await app.request("/v1/chat/completions", {
				method: "POST",
				headers,
				body: JSON.stringify({
					model: "openai/gpt-4o-mini",
					messages: [{ role: "user", content: "Do not weaken either policy" }],
				}),
			});
			expect(response.status, await response.text()).toBe(403);
		},
	);

	test("fallback and provider pins cannot escape key provider restrictions", async () => {
		await harness.setProjectMode("api-keys");
		await db
			.update(tables.organization)
			.set({
				providerCompliancePolicy: {
					enabled: true,
					allowedProviders: ["together-ai", "cerebras"],
				},
			})
			.where(eq(tables.organization.id, "org-id"));
		await db
			.update(tables.apiKey)
			.set({
				providerCompliancePolicy: {
					enabled: true,
					allowedProviders: ["together-ai"],
				},
			})
			.where(eq(tables.apiKey.id, "compliance-key"));
		for (const provider of ["together-ai", "cerebras"]) {
			const id = `policy-provider-${provider}`;
			await db.insert(tables.providerKey).values({
				id,
				organizationId: "org-id",
				provider,
				...encryptProviderKeyForStorage("test-token", id, "org-id"),
				baseUrl: `${harness.mockServerUrl}/${provider}`,
			});
		}
		const upstreamUrls: string[] = [];
		const upstream = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async (input) => {
				upstreamUrls.push(
					typeof input === "string"
						? input
						: input instanceof URL
							? input.toString()
							: input.url,
				);
				return Response.json(
					{ error: { message: "Provider unavailable", type: "server_error" } },
					{ status: 500 },
				);
			});
		try {
			const request = (model: string, pinned = false) =>
				app.request("/v1/chat/completions", {
					method: "POST",
					headers: {
						...headers,
						...(pinned ? { "x-no-fallback": "true" } : {}),
					},
					body: JSON.stringify({
						model,
						messages: [
							{ role: "user", content: "Do not escape compliance on retry" },
						],
					}),
				});
			const response = await request("glm-4.7");
			expect([500, 502], await response.text()).toContain(response.status);
			expect(upstreamUrls.some((url) => url.includes("/together-ai/"))).toBe(
				true,
			);
			expect(upstreamUrls.some((url) => url.includes("/cerebras/"))).toBe(
				false,
			);
			const pinnedResponse = await request("cerebras/glm-4.7", true);
			expect(pinnedResponse.status, await pinnedResponse.text()).toBe(403);
			expect(upstreamUrls.some((url) => url.includes("/cerebras/"))).toBe(
				false,
			);
		} finally {
			upstream.mockRestore();
		}
	});

	test("transcriptions enforce key policy before sending audio", async () => {
		const body = new FormData();
		body.set("model", "grok-stt-1-0");
		body.set(
			"file",
			new File(["MOCK_AUDIO_BYTES"], "audio.mp3", { type: "audio/mpeg" }),
		);
		const response = await app.request("/v1/audio/transcriptions", {
			method: "POST",
			headers: { Authorization: headers.Authorization },
			body,
		});
		expect(response.status, await response.text()).toBe(403);
	});

	test.each(["", "/content"])(
		"video retrieval%s rechecks request key policy",
		async (suffix) => {
			await db.insert(tables.videoJob).values({
				id: "policy-video",
				requestId: "policy-request",
				organizationId: "org-id",
				projectId: "project-id",
				apiKeyId: "compliance-key",
				mode: "credits",
				usedMode: "credits",
				model: "kling-v3-0",
				usedModel: "kling-v3-0",
				usedProvider: "atlascloud",
				upstreamId: "policy-upstream",
				prompt: "Policy regression",
				status: "completed",
			});
			const response = await app.request(`/v1/videos/policy-video${suffix}`, {
				headers,
			});
			expect(response.status, await response.text()).toBe(403);
		},
	);

	test("model discovery filters by key policy", async () => {
		await db
			.update(tables.apiKey)
			.set({
				providerCompliancePolicy: {
					enabled: true,
					allowedModels: ["gpt-4o-mini"],
					allowedProviders: ["openai"],
				},
			})
			.where(eq(tables.apiKey.id, "compliance-key"));
		const response = await app.request("/v1/models", { headers });
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			data: { id: string; providers: { providerId: string }[] }[];
		};
		expect(body.data.map((model) => model.id)).toEqual(["gpt-4o-mini"]);
		expect(
			body.data[0].providers.map((provider) => provider.providerId),
		).toEqual(["openai"]);
	});

	test.each(["/v1/responses", "/v1/videos"])(
		"%s rejects storage under key ZDR",
		async (path) => {
			await db
				.update(tables.apiKey)
				.set({
					providerCompliancePolicy: { enabled: true, zeroDataRetention: true },
				})
				.where(eq(tables.apiKey.id, "compliance-key"));
			const body =
				path === "/v1/responses"
					? { model: "gpt-4o-mini", input: "Do not store this" }
					: {
							model: "atlascloud/kling-v3-0",
							prompt: "Do not store this",
							size: "1280x720",
							seconds: 5,
						};
			const response = await app.request(path, {
				method: "POST",
				headers,
				body: JSON.stringify(body),
			});
			expect(response.status, await response.text()).toBe(400);
		},
	);
	test.each([
		["", true, 200],
		["/content", true, 409],
		["", false, 403],
		["/content", false, 403],
	] as const)(
		"video retrieval%s checks catalogue model ID (allowed=%s)",
		async (suffix, allowed, expectedStatus) => {
			const canonicalModel = "veo-3.1-generate-preview";
			await db
				.update(tables.apiKey)
				.set({
					providerCompliancePolicy: {
						enabled: true,
						...(allowed
							? { allowedModels: [canonicalModel] }
							: { blockedModels: [canonicalModel] }),
					},
				})
				.where(eq(tables.apiKey.id, "compliance-key"));
			await db.insert(tables.videoJob).values({
				id: "canonical-policy-video",
				requestId: "canonical-policy-request",
				organizationId: "org-id",
				projectId: "project-id",
				apiKeyId: "compliance-key",
				mode: "credits",
				usedMode: "credits",
				model: canonicalModel,
				usedModel: "veo-3.1-generate-001",
				usedProvider: "google-vertex",
				upstreamId: "policy-upstream",
				prompt: "Policy regression",
				status: "queued",
			});
			const response = await app.request(
				`/v1/videos/canonical-policy-video${suffix}`,
				{ headers },
			);
			expect(response.status, await response.text()).toBe(expectedStatus);
		},
	);
});
