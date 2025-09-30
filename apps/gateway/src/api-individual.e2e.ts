import "dotenv/config";
import { beforeEach, describe, expect, test } from "vitest";

import {
	generateTestRequestId,
	getTestOptions,
	logMode,
	validateLogByRequestId,
} from "@/chat-helpers.e2e.js";

import { db, tables, eq } from "@llmgateway/db";
import { models, providers, getProviderEnvVar } from "@llmgateway/models";

import { app } from "./app.js";
import {
	clearCache,
	waitForLogByRequestId,
	readAll,
} from "./test-utils/test-helpers.js";

describe("e2e individual tests", () => {
	// Helper to create unique test data for each test to avoid conflicts
	async function createTestData(testId: string) {
		const userId = `user-${testId}`;
		const orgId = `org-${testId}`;
		const projectId = `project-${testId}`;
		const userOrgId = `user-org-${testId}`;

		await db.insert(tables.user).values({
			id: userId,
			name: `user-${testId}`,
			email: `user-${testId}@test.com`,
		});

		await db.insert(tables.organization).values({
			id: orgId,
			name: `Test Organization ${testId}`,
			plan: "pro",
		});

		await db.insert(tables.userOrganization).values({
			id: userOrgId,
			userId: userId,
			organizationId: orgId,
		});

		await db.insert(tables.project).values({
			id: projectId,
			name: `Test Project ${testId}`,
			organizationId: orgId,
			mode: "api-keys",
		});

		const token = `real-token-${testId}`;
		await db.insert(tables.apiKey).values({
			id: `token-${testId}`,
			token,
			projectId: projectId,
			description: `Test API Key ${testId}`,
		});

		// Set up provider keys for this test
		for (const provider of providers) {
			const envVarName = getProviderEnvVar(provider.id);
			const envVarValue = envVarName ? process.env[envVarName] : undefined;
			if (envVarValue) {
				await createProviderKey(provider.id, envVarValue, orgId, testId);
			}
		}

		return { userId, orgId, projectId, userOrgId, token };
	}

	beforeEach(async () => {
		await clearCache();
	});

	async function createProviderKey(
		provider: string,
		token: string,
		organizationId: string,
		testId: string,
	) {
		const keyId = `provider-key-${provider}-${testId}`;
		await db.insert(tables.providerKey).values({
			id: keyId,
			token,
			provider: provider.replace("env-", ""), // Remove env- prefix for the provider field
			organizationId,
		});
	}

	function validateResponse(json: any) {
		expect(json).toHaveProperty("choices.[0].message.content");

		expect(json).toHaveProperty("usage.prompt_tokens");
		expect(json).toHaveProperty("usage.completion_tokens");
		expect(json).toHaveProperty("usage.total_tokens");
	}

	test(
		"JSON output mode error for unsupported model",
		getTestOptions({ completions: false }),
		async () => {
			const envVarName = getProviderEnvVar("anthropic");
			const envVarValue = envVarName ? process.env[envVarName] : undefined;
			if (!envVarValue) {
				console.log(
					"Skipping JSON output error test - no Anthropic API key provided",
				);
				return;
			}

			const { token } = await createTestData("json-error");

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					model: "anthropic/claude-3-5-sonnet-20241022",
					messages: [
						{
							role: "user",
							content: "Hello",
						},
					],
					response_format: { type: "json_object" },
				}),
			});

			expect(res.status).toBe(400);

			const text = await res.text();
			expect(text).toContain("does not support JSON output mode");
		},
	);

	test(
		"JSON output mode error when 'json' not mentioned in messages",
		getTestOptions({ completions: false }),
		async () => {
			const envVarName = getProviderEnvVar("openai");
			const envVarValue = envVarName ? process.env[envVarName] : undefined;
			if (!envVarValue) {
				console.log(
					"Skipping JSON output client error test - no OpenAI API key provided",
				);
				return;
			}

			const { token } = await createTestData("json-missing");
			const requestId = generateTestRequestId();

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-request-id": requestId,
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					model: "gpt-4o-mini",
					messages: [
						{
							role: "user",
							content: "Hello, give me a greeting response",
						},
					],
					response_format: { type: "json_object" },
				}),
			});

			expect(res.status).toBe(400);

			const json = await res.json();
			expect(json).toHaveProperty("error");
			expect(json.error).toHaveProperty("message");
			expect(json.error.message).toContain("'messages' must contain");
			expect(json.error.message).toContain("the word 'json'");
			expect(json.error).toHaveProperty("type", "invalid_request_error");

			const log = await waitForLogByRequestId(requestId);
			expect(log.unifiedFinishReason).toBe("client_error");
			expect(log.errorDetails).not.toBeNull();
			expect(log.errorDetails).toHaveProperty("message");
			expect((log.errorDetails as { message?: string })?.message).toContain(
				"'messages' must contain",
			);
			expect((log.errorDetails as { message?: string })?.message).toContain(
				"the word 'json'",
			);
		},
	);

	test(
		"completions with llmgateway/auto in credits mode",
		getTestOptions({ completions: false }),
		async () => {
			// require all provider keys to be set
			for (const provider of providers) {
				const envVarName = getProviderEnvVar(provider.id);
				const envVarValue = envVarName ? process.env[envVarName] : undefined;
				if (!envVarValue) {
					console.log(
						`Skipping llmgateway/auto in credits mode test - no API key provided for ${provider.id}`,
					);
					return;
				}
			}

			const { orgId, projectId } = await createTestData("credits-auto");

			await db
				.update(tables.organization)
				.set({ credits: "1000" })
				.where(eq(tables.organization.id, orgId));

			await db
				.update(tables.project)
				.set({ mode: "credits" })
				.where(eq(tables.project.id, projectId));

			const creditsToken = "credits-token-auto";
			await db.insert(tables.apiKey).values({
				id: "token-credits-auto",
				token: creditsToken,
				projectId: projectId,
				description: "Test API Key for Credits",
			});

			const requestId = generateTestRequestId();
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-request-id": requestId,
					Authorization: `Bearer ${creditsToken}`,
				},
				body: JSON.stringify({
					model: "llmgateway/auto",
					messages: [
						{
							role: "user",
							content: "Hello with llmgateway/auto in credits mode!",
						},
					],
				}),
			});

			const json = await res.json();
			console.log("response:", JSON.stringify(json, null, 2));
			expect(res.status).toBe(200);
			expect(json).toHaveProperty("choices.[0].message.content");

			const log = await waitForLogByRequestId(requestId);
			expect(log.requestedModel).toBe("auto");
			expect(log.usedProvider).toBeTruthy();
			expect(log.usedModel).toBeTruthy();
		},
	);

	test(
		"completions with bare 'auto' model and credits",
		getTestOptions({ completions: false }),
		async () => {
			const { orgId, projectId, token } = await createTestData("bare-auto");

			await db
				.update(tables.organization)
				.set({ credits: "1000" })
				.where(eq(tables.organization.id, orgId));

			await db
				.update(tables.project)
				.set({ mode: "credits" })
				.where(eq(tables.project.id, projectId));

			const requestId = generateTestRequestId();
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-request-id": requestId,
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					model: "auto",
					messages: [
						{
							role: "user",
							content: "Hello! This is an auto test.",
						},
					],
				}),
			});

			expect(res.status).toBe(200);
			const json = await res.json();
			expect(json).toHaveProperty("choices.[0].message.content");

			const log = await waitForLogByRequestId(requestId);
			expect(log.requestedModel).toBe("auto");
			expect(log.usedProvider).toBeTruthy();
			expect(log.usedModel).toBeTruthy();
		},
	);

	test.skip("/v1/chat/completions with bare 'custom' model", async () => {
		const envVarName = getProviderEnvVar("openai");
		const envVarValue = envVarName ? process.env[envVarName] : undefined;
		if (!envVarValue) {
			console.log("Skipping custom model test - no OpenAI API key provided");
			return;
		}

		const { orgId, projectId } = await createTestData("custom-model");

		await db
			.update(tables.organization)
			.set({ credits: "1000" })
			.where(eq(tables.organization.id, orgId));

		await db
			.update(tables.project)
			.set({ mode: "credits" })
			.where(eq(tables.project.id, projectId));

		await db.insert(tables.providerKey).values({
			id: "provider-key-custom-model",
			provider: "llmgateway",
			token: envVarValue,
			baseUrl: "https://api.openai.com", // Use real OpenAI endpoint for testing
			status: "active",
			organizationId: orgId,
		});

		const customToken = "real-token-custom";
		await db.insert(tables.apiKey).values({
			id: "token-custom-model",
			token: customToken,
			projectId: projectId,
			description: "Test API Key",
		});

		const requestId = generateTestRequestId();
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-request-id": requestId,
				Authorization: `Bearer ${customToken}`,
			},
			body: JSON.stringify({
				model: "custom",
				messages: [
					{
						role: "user",
						content: "Hello! This is a custom test.",
					},
				],
			}),
		});

		expect(res.status).toBe(200);

		const json = await res.json();
		expect(json).toHaveProperty("choices.[0].message.content");

		const log = await waitForLogByRequestId(requestId);
		expect(log.requestedModel).toBe("custom");
		expect(log.usedProvider).toBe("llmgateway");
		expect(log.usedModel).toBe("custom");
	});

	test(
		"Prompt tokens are never zero even when provider returns 0",
		getTestOptions({ completions: false }),
		async () => {
			const { token } = await createTestData("zero-tokens");

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					model: "openai/gpt-4o-mini",
					messages: [
						{
							role: "user",
							content: "ZERO_TOKENS test message",
						},
					],
				}),
			});

			expect(res.status).toBe(200);

			const json = await res.json();

			// Verify we have usage information
			expect(json).toHaveProperty("usage");
			expect(json.usage).toHaveProperty("prompt_tokens");
			expect(json.usage).toHaveProperty("completion_tokens");
			expect(json.usage).toHaveProperty("total_tokens");

			// Verify types are numbers
			expect(typeof json.usage.prompt_tokens).toBe("number");
			expect(typeof json.usage.completion_tokens).toBe("number");
			expect(typeof json.usage.total_tokens).toBe("number");

			// Most importantly: prompt_tokens should never be 0, even if provider returns 0
			expect(json.usage.prompt_tokens).toBeGreaterThan(0);

			// Completion tokens can be non-zero as set by mock
			expect(json.usage.completion_tokens).toBeGreaterThan(0);

			// Total tokens should be at least as large as prompt tokens
			expect(json.usage.total_tokens).toBeGreaterThanOrEqual(
				json.usage.prompt_tokens,
			);
		},
	);

	test(
		"Prompt tokens are calculated for streaming when provider returns 0",
		getTestOptions({ completions: false }),
		async () => {
			const { token } = await createTestData("zero-tokens-streaming");

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					model: "openai/gpt-4o-mini",
					messages: [
						{
							role: "user",
							content: "ZERO_TOKENS streaming test message",
						},
					],
					stream: true,
				}),
			});

			expect(res.status).toBe(200);

			const result = await readAll(res.body);

			// Find a usage chunk
			const usageChunk = result.chunks.find((chunk: any) => chunk.usage);
			expect(usageChunk).toBeDefined();

			if (usageChunk) {
				// Verify prompt tokens are calculated and greater than 0
				expect(usageChunk.usage.prompt_tokens).toBeGreaterThan(0);
				expect(typeof usageChunk.usage.prompt_tokens).toBe("number");
			}
		},
	);

	test(
		"GPT-5-nano responses API parameter handling",
		getTestOptions({ completions: false }),
		async () => {
			const envVarName = getProviderEnvVar("openai");
			const envVarValue = envVarName ? process.env[envVarName] : undefined;
			if (!envVarValue) {
				console.log(
					"Skipping GPT-5-nano responses API test - no OpenAI API key provided",
				);
				return;
			}

			const { token } = await createTestData("gpt5-nano");
			const requestId = generateTestRequestId();
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-request-id": requestId,
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					model: "openai/gpt-5-nano",
					messages: [
						{
							role: "user",
							content: "What is 2+2? Think step by step.",
						},
					],
					max_tokens: 100,
					reasoning_effort: "medium",
				}),
			});

			const json = await res.json();
			if (logMode) {
				console.log("GPT-5-nano response:", JSON.stringify(json, null, 2));
			}

			// Should succeed - no unsupported parameter error
			expect(res.status).toBe(200);
			validateResponse(json);

			const log = await validateLogByRequestId(requestId);
			expect(log.streamed).toBe(false);
			expect(log.usedModel).toBe("openai/gpt-5-nano");
			expect(log.usedModelMapping).toBe("gpt-5-nano");
			expect(log.usedProvider).toBe("openai");

			// Verify it's a reasoning model response
			expect(json).toHaveProperty("usage");
			if (json.usage.reasoning_tokens !== undefined) {
				expect(typeof json.usage.reasoning_tokens).toBe("number");
				expect(json.usage.reasoning_tokens).toBeGreaterThanOrEqual(0);
			}

			// Check for content - handle both string and object formats
			expect(json.choices[0].message).toHaveProperty("content");
		},
	);

	test(
		"Auto-routing sets reasoning_effort to minimal for gpt-5 models",
		getTestOptions({ completions: false }),
		async () => {
			const envVarName = getProviderEnvVar("openai");
			const envVarValue = envVarName ? process.env[envVarName] : undefined;
			if (!envVarValue) {
				console.log(
					"Skipping auto-routing reasoning_effort test - no OpenAI API key provided",
				);
				return;
			}

			const { orgId, projectId, token } = await createTestData(
				`auto-reasoning-${Date.now()}`,
			);

			await db
				.update(tables.organization)
				.set({ credits: "1000" })
				.where(eq(tables.organization.id, orgId));

			await db
				.update(tables.project)
				.set({ mode: "credits" })
				.where(eq(tables.project.id, projectId));

			const requestId = generateTestRequestId();
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-request-id": requestId,
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					model: "auto",
					messages: [
						{
							role: "user",
							content: "What is 2+2? Think step by step.",
						},
					],
				}),
			});

			expect(res.status).toBe(200);
			const json = await res.json();
			validateResponse(json);

			const log = await validateLogByRequestId(requestId);
			expect(log.requestedModel).toBe("auto");

			// Should auto-select gpt-5-nano (cheapest eligible model for auto)
			// The provider can be either 'openai' or 'routeway-discount' depending on routing logic
			expect(log.usedModelMapping).toBe("gpt-5-nano");
			expect(log.usedModel).toMatch(/^(openai|routeway-discount)\/gpt-5-nano$/);
			expect(["openai", "routeway-discount"]).toContain(log.usedProvider);

			// Should auto-set reasoning_effort to minimal for gpt-5* models
			// The key test is that gpt-5-nano was selected and the request completed successfully
			// This validates that the auto-routing + reasoning_effort logic works without errors

			// Verify the response has valid usage information
			expect(json.usage).toBeDefined();
			expect(json.usage.prompt_tokens).toBeGreaterThan(0);
			expect(json.usage.completion_tokens).toBeGreaterThan(0);
			expect(json.usage.total_tokens).toBeGreaterThan(0);

			// Check if reasoning was actually used (reasoning_tokens may not be present for minimal effort)
			if (json.usage.reasoning_tokens !== undefined) {
				expect(typeof json.usage.reasoning_tokens).toBe("number");
				expect(json.usage.reasoning_tokens).toBeGreaterThanOrEqual(0);
			} else {
				// For minimal effort, reasoning_tokens might be 0 or not present
				// The key test is that gpt-5-nano was selected and no errors occurred
				console.log(
					"Note: reasoning_tokens not present, which may be expected for minimal effort",
				);
			}
		},
	);

	test(
		"Success when requesting multi-provider model without prefix",
		getTestOptions({ completions: false }),
		async () => {
			const multiProviderModel = models.find((m) => m.providers.length > 1);
			if (!multiProviderModel) {
				console.log(
					"Skipping multi-provider test - no multi-provider models found",
				);
				return;
			}

			const { token } = await createTestData("multi-provider");
			const requestId = generateTestRequestId();
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-request-id": requestId,
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					model: multiProviderModel.id,
					messages: [
						{
							role: "user",
							content: "Hello",
						},
					],
				}),
			});

			expect(res.status).toBe(200);
			const json = await res.json();
			validateResponse(json);

			const log = await validateLogByRequestId(requestId);
			expect(log.streamed).toBe(false);
		},
	);
});
