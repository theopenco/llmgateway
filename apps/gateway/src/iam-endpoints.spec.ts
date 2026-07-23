import { describe, expect, test } from "vitest";

import { db, tables } from "@llmgateway/db";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";

// Every user-facing gateway endpoint must evaluate IAM rules. Each test seeds
// a member-level deny rule (the org-admin ceiling from the Team page) and
// asserts the endpoint rejects the request with the member-scope denial
// message — proving the full IAM chain (member rules AND key rules) runs for
// that endpoint. /v1/responses, /v1/messages, and /v1/images delegate to
// /v1/chat/completions internally, so the denial must survive that hop too.
describe("IAM rule evaluation per endpoint", () => {
	const harness = createGatewayApiTestHarness();

	const MEMBER_RULE_MESSAGE =
		"organization member IAM rule set by your org admin";

	async function seedApiKey(token: string) {
		await db.insert(tables.apiKey).values({
			id: `key-${token}`,
			token,
			projectId: "project-id",
			description: "IAM endpoint test key",
			createdBy: "user-id",
		});
	}

	async function seedMemberRule(
		id: string,
		ruleType:
			| "allow_models"
			| "deny_models"
			| "allow_providers"
			| "deny_providers",
		ruleValue: { models?: string[]; providers?: string[] },
	) {
		await db.insert(tables.userIamRule).values({
			id,
			userOrganizationId: "user-org-id",
			ruleType,
			ruleValue,
			status: "active",
		});
	}

	async function seedProviderKeys(providers: string[]) {
		for (const provider of providers) {
			await db.insert(tables.providerKey).values({
				id: `provider-key-${provider}`,
				token: `${provider}-test-key`,
				provider,
				organizationId: "org-id",
				baseUrl: harness.mockServerUrl,
				...(provider === "google-vertex"
					? { options: { google_vertex_project_id: "test-project" } }
					: {}),
			});
		}
	}

	async function expectMemberDenial(res: Response) {
		expect(res.status).toBe(403);
		const body = JSON.stringify(await res.json());
		expect(body).toContain(MEMBER_RULE_MESSAGE);
	}

	test("/v1/chat/completions evaluates member IAM rules", async () => {
		await seedApiKey("iam-chat-token");
		await seedProviderKeys(["openai"]);
		await seedMemberRule("iam-chat-rule", "deny_models", {
			models: ["gpt-4o-mini"],
		});

		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer iam-chat-token",
			},
			body: JSON.stringify({
				model: "gpt-4o-mini",
				messages: [{ role: "user", content: "Hello!" }],
			}),
		});

		await expectMemberDenial(res);
	});

	test("/v1/embeddings evaluates member IAM rules", async () => {
		await seedApiKey("iam-embeddings-token");
		await seedProviderKeys(["openai"]);
		await seedMemberRule("iam-embeddings-rule", "deny_models", {
			models: ["text-embedding-3-small"],
		});

		const res = await app.request("/v1/embeddings", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer iam-embeddings-token",
			},
			body: JSON.stringify({
				input: "Hello",
				model: "text-embedding-3-small",
			}),
		});

		await expectMemberDenial(res);
	});

	test("/v1/images/generations evaluates member IAM rules (via chat delegation)", async () => {
		await seedApiKey("iam-images-token");
		await seedProviderKeys(["google-ai-studio"]);
		await seedMemberRule("iam-images-rule", "deny_models", {
			models: ["gemini-2.5-flash-image"],
		});

		const res = await app.request("/v1/images/generations", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer iam-images-token",
			},
			body: JSON.stringify({
				model: "gemini-2.5-flash-image",
				prompt: "A watercolor of a city skyline",
			}),
		});

		await expectMemberDenial(res);
	});

	test("/v1/moderations evaluates member IAM rules", async () => {
		await seedApiKey("iam-moderations-token");
		await seedProviderKeys(["openai"]);
		await seedMemberRule("iam-moderations-rule", "deny_providers", {
			providers: ["openai"],
		});

		const res = await app.request("/v1/moderations", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer iam-moderations-token",
			},
			body: JSON.stringify({
				input: "I want to attack someone.",
			}),
		});

		await expectMemberDenial(res);
	});

	test("/v1/moderations evaluates key-level IAM rules", async () => {
		await seedApiKey("iam-moderations-key-token");
		await seedProviderKeys(["openai"]);
		await db.insert(tables.apiKeyIamRule).values({
			id: "iam-moderations-key-rule",
			apiKeyId: "key-iam-moderations-key-token",
			ruleType: "deny_providers",
			ruleValue: { providers: ["openai"] },
			status: "active",
		});

		const res = await app.request("/v1/moderations", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer iam-moderations-key-token",
			},
			body: JSON.stringify({
				input: "I want to attack someone.",
			}),
		});

		expect(res.status).toBe(403);
		const body = JSON.stringify(await res.json());
		expect(body).toContain("denied providers list");
	});

	test("/v1/moderations ignores model and pricing allowlists (backward compat)", async () => {
		// Existing orgs commonly have allow_models rules that predate member IAM.
		// The moderation pseudo-model is not in the catalogue and can never be
		// added to an allowlist, so model/pricing rules must not gate moderation.
		await seedApiKey("iam-moderations-compat-token");
		await seedProviderKeys(["openai"]);
		await seedMemberRule("iam-moderations-compat-member", "allow_models", {
			models: ["gpt-4o-mini"],
		});
		await db.insert(tables.apiKeyIamRule).values({
			id: "iam-moderations-compat-key",
			apiKeyId: "key-iam-moderations-compat-token",
			ruleType: "allow_models",
			ruleValue: { models: ["gpt-4o-mini"] },
			status: "active",
		});

		const res = await app.request("/v1/moderations", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer iam-moderations-compat-token",
			},
			body: JSON.stringify({
				input: "I want to attack someone.",
			}),
		});

		expect(res.status).toBe(200);
	});

	test("/v1/messages evaluates member IAM rules (via chat delegation)", async () => {
		await seedApiKey("iam-messages-token");
		await seedProviderKeys(["openai"]);
		await seedMemberRule("iam-messages-rule", "deny_models", {
			models: ["gpt-4o-mini"],
		});

		const res = await app.request("/v1/messages", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer iam-messages-token",
			},
			body: JSON.stringify({
				model: "gpt-4o-mini",
				max_tokens: 1024,
				messages: [{ role: "user", content: "Hello!" }],
			}),
		});

		await expectMemberDenial(res);
	});

	test("/v1/responses evaluates member IAM rules (via chat delegation)", async () => {
		await seedApiKey("iam-responses-token");
		await seedProviderKeys(["openai"]);
		await seedMemberRule("iam-responses-rule", "deny_models", {
			models: ["gpt-5.5"],
		});

		const res = await app.request("/v1/responses", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer iam-responses-token",
			},
			body: JSON.stringify({
				model: "openai/gpt-5.5",
				input: "Hello!",
			}),
		});

		await expectMemberDenial(res);
	});

	test("/v1/audio/speech evaluates member IAM rules", async () => {
		await seedApiKey("iam-speech-token");
		await seedProviderKeys(["google-ai-studio"]);
		await seedMemberRule("iam-speech-rule", "deny_models", {
			models: ["gemini-2.5-flash-preview-tts"],
		});

		const res = await app.request("/v1/audio/speech", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer iam-speech-token",
			},
			body: JSON.stringify({
				model: "gemini-2.5-flash-preview-tts",
				input: "Hello there",
				voice: "Kore",
			}),
		});

		await expectMemberDenial(res);
	});

	test("/v1/videos evaluates member IAM rules", async () => {
		await seedApiKey("iam-videos-token");
		await seedProviderKeys(["google-vertex"]);
		await seedMemberRule("iam-videos-rule", "deny_models", {
			models: ["veo-3.1-generate-preview"],
		});

		const res = await app.request("/v1/videos", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer iam-videos-token",
			},
			body: JSON.stringify({
				model: "veo-3.1-generate-preview",
				prompt: "A neon city at night",
				size: "1920x1080",
				seconds: 8,
			}),
		});

		await expectMemberDenial(res);
	});

	test("/v1/ocr evaluates member IAM rules", async () => {
		await seedApiKey("iam-ocr-token");
		await seedProviderKeys(["mistral"]);
		await seedMemberRule("iam-ocr-rule", "deny_models", {
			models: ["mistral-ocr-latest"],
		});

		const res = await app.request("/v1/ocr", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer iam-ocr-token",
			},
			body: JSON.stringify({
				model: "mistral-ocr-latest",
				document: {
					type: "image_url",
					image_url: "https://example.com/PAGES_3.png",
				},
			}),
		});

		await expectMemberDenial(res);
	});

	test("a key-level allow rule cannot expand past the member ceiling", async () => {
		await seedApiKey("iam-ceiling-token");
		await seedProviderKeys(["openai", "anthropic"]);
		await seedMemberRule("iam-ceiling-rule", "allow_providers", {
			providers: ["anthropic"],
		});
		// The key explicitly allows openai — but the member ceiling excludes it,
		// so requesting an openai-only model must still be denied.
		await db.insert(tables.apiKeyIamRule).values({
			id: "iam-ceiling-key-rule",
			apiKeyId: "key-iam-ceiling-token",
			ruleType: "allow_providers",
			ruleValue: { providers: ["openai"] },
			status: "active",
		});

		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer iam-ceiling-token",
			},
			body: JSON.stringify({
				model: "gpt-4o-mini",
				messages: [{ role: "user", content: "Hello!" }],
			}),
		});

		expect(res.status).toBe(403);
	});
});
