import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

describe("logs route", () => {
	let token: string;

	afterEach(async () => {
		await deleteAll();
	});

	beforeEach(async () => {
		token = await createTestUser();

		// Create test organizations
		await db.insert(tables.organization).values([
			{
				id: "test-org-id",
				name: "Test Organization",
				billingEmail: "test@example.com",
			},
			{
				id: "test-org-id-2",
				name: "Test Organization 2",
				billingEmail: "test2@example.com",
			},
		]);

		// Associate user with organizations
		await db.insert(tables.userOrganization).values([
			{
				id: "test-user-org-id",
				userId: "test-user-id",
				organizationId: "test-org-id",
			},
			{
				id: "test-user-org-id-2",
				userId: "test-user-id",
				organizationId: "test-org-id-2",
			},
		]);

		// Create test projects
		await db.insert(tables.project).values([
			{
				id: "test-project-id",
				name: "Test Project",
				organizationId: "test-org-id",
			},
			{
				id: "test-project-id-2",
				name: "Test Project 2",
				organizationId: "test-org-id-2",
			},
		]);

		// Create test API keys
		await db.insert(tables.apiKey).values([
			{
				id: "test-api-key-id",
				...hashApiKeyForStorage("test-token"),
				projectId: "test-project-id",
				description: "Test API Key",
				createdBy: "test-user-id",
			},
			{
				id: "test-api-key-id-2",
				...hashApiKeyForStorage("test-token-2"),
				projectId: "test-project-id-2",
				description: "Test API Key 2",
				createdBy: "test-user-id",
			},
		]);

		// Create test provider keys
		await db.insert(tables.providerKey).values([
			{
				id: "test-provider-key-id",
				...encryptProviderKeyForStorage(
					"test-provider-token",
					"test-provider-key-id",
					"test-org-id",
				),
				provider: "openai",
				organizationId: "test-org-id",
			},
			{
				id: "test-provider-key-id-2",
				...encryptProviderKeyForStorage(
					"test-provider-token-2",
					"test-provider-key-id-2",
					"test-org-id-2",
				),
				provider: "anthropic",
				organizationId: "test-org-id-2",
			},
		]);

		// Create test logs
		await db.insert(tables.log).values([
			{
				id: "test-log-id-1",
				requestId: "test-log-id-1",
				organizationId: "test-org-id",
				projectId: "test-project-id",
				apiKeyId: "test-api-key-id",
				duration: 100,
				requestedModel: "gpt-4",
				requestedProvider: "openai",
				usedModel: "gpt-4",
				usedProvider: "openai",
				responseSize: 1000,
				content: "Test response content",
				finishReason: "stop",
				promptTokens: "10",
				completionTokens: "20",
				totalTokens: "30",
				temperature: 0.7,
				maxTokens: 100,
				messages: JSON.stringify([{ role: "user", content: "Hello" }]),
				gatewayContentFilterResponse: [
					{
						id: "modr-test-log-id-1",
						model: "omni-moderation-latest",
						results: [
							{
								flagged: true,
								categories: {
									violence: true,
								},
								category_scores: {
									violence: 0.95,
								},
							},
						],
					},
				],
				mode: "api-keys",
				usedMode: "api-keys",
			},
			{
				id: "test-log-id-2",
				requestId: "test-log-id-2",
				organizationId: "test-org-id",
				projectId: "test-project-id-2",
				apiKeyId: "test-api-key-id-2",
				duration: 200,
				requestedModel: "claude-3-haiku",
				requestedProvider: "anthropic",
				usedModel: "claude-3-haiku",
				usedProvider: "anthropic",
				responseSize: 2000,
				content: "Test response content 2",
				finishReason: "stop",
				promptTokens: "20",
				completionTokens: "40",
				totalTokens: "60",
				temperature: 0.8,
				maxTokens: 200,
				messages: JSON.stringify([{ role: "user", content: "Hello 2" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
		]);
	});

	test("should return 401 when not authenticated", async () => {
		const res = await app.request("/logs");
		expect(res.status).toBe(401);
	});

	// Tests for the filter functionality
	describe("filter functionality", () => {
		test("should expose gateway content filter responses in list results", async () => {
			const params = new URLSearchParams({ projectId: "test-project-id" });
			const res = await app.request("/logs?" + params, {
				method: "GET",
				headers: {
					Cookie: token,
				},
			});

			expect(res.status).toBe(200);
			const json = await res.json();
			expect(json.logs[0].organizationName).toBe("Test Organization");
			expect(json.logs[0].projectName).toBe("Test Project");
			expect(json.logs[0].apiKeyName).toBe("Test API Key");
			expect(json.logs[0].gatewayContentFilterResponse).toEqual([
				{
					id: "modr-test-log-id-1",
					model: "omni-moderation-latest",
					results: [
						{
							flagged: true,
							categories: {
								violence: true,
							},
							category_scores: {
								violence: 0.95,
							},
						},
					],
				},
			]);
		});

		test("should expose gateway content filter responses by id", async () => {
			const res = await app.request("/logs/test-log-id-1", {
				method: "GET",
				headers: {
					Cookie: token,
				},
			});

			expect(res.status).toBe(200);
			const json = await res.json();
			expect(json.log.organizationName).toBe("Test Organization");
			expect(json.log.projectName).toBe("Test Project");
			expect(json.log.apiKeyName).toBe("Test API Key");
			expect(json.log.gatewayContentFilterResponse).toEqual([
				{
					id: "modr-test-log-id-1",
					model: "omni-moderation-latest",
					results: [
						{
							flagged: true,
							categories: {
								violence: true,
							},
							category_scores: {
								violence: 0.95,
							},
						},
					],
				},
			]);
		});

		test("should filter logs by projectId", async () => {
			const params = new URLSearchParams({ projectId: "test-project-id" });
			const res = await app.request("/logs?" + params, {
				method: "GET",
				headers: {
					Cookie: token,
				},
			});

			expect(res.status).toBe(200);
			const json = await res.json();
			expect(json.logs.length).toBe(1);
			expect(json.logs[0].projectId).toBe("test-project-id");
			expect(json.pagination).toBeDefined();
			expect(json.pagination.hasMore).toBe(false);
			expect(json.pagination.nextCursor).toBeNull();
			expect(json.pagination.limit).toBe(50);
		});

		test("should filter logs by usedMode", async () => {
			await db.insert(tables.log).values({
				id: "test-log-credits",
				requestId: "test-log-credits",
				organizationId: "test-org-id",
				projectId: "test-project-id",
				apiKeyId: "test-api-key-id",
				duration: 100,
				requestedModel: "gpt-4",
				requestedProvider: "openai",
				usedModel: "gpt-4",
				usedProvider: "openai",
				responseSize: 500,
				promptTokens: "5",
				completionTokens: "5",
				totalTokens: "10",
				messages: JSON.stringify([{ role: "user", content: "credits" }]),
				mode: "hybrid",
				usedMode: "credits",
			});

			const creditsRes = await app.request(
				"/logs?" +
					new URLSearchParams({
						projectId: "test-project-id",
						usedMode: "credits",
					}),
				{ headers: { Cookie: token } },
			);
			expect(creditsRes.status).toBe(200);
			const creditsJson = await creditsRes.json();
			expect(creditsJson.logs.length).toBe(1);
			expect(creditsJson.logs[0].id).toBe("test-log-credits");
			expect(creditsJson.logs[0].usedMode).toBe("credits");

			const byokRes = await app.request(
				"/logs?" +
					new URLSearchParams({
						projectId: "test-project-id",
						usedMode: "api-keys",
					}),
				{ headers: { Cookie: token } },
			);
			expect(byokRes.status).toBe(200);
			const byokJson = await byokRes.json();
			expect(byokJson.logs.length).toBe(1);
			expect(byokJson.logs[0].id).toBe("test-log-id-1");

			// "all" behaves like no filter.
			const allRes = await app.request(
				"/logs?" +
					new URLSearchParams({
						projectId: "test-project-id",
						usedMode: "all",
					}),
				{ headers: { Cookie: token } },
			);
			expect(allRes.status).toBe(200);
			const allJson = await allRes.json();
			expect(allJson.logs.length).toBe(2);
		});

		test("should filter by second projectId", async () => {
			const params = new URLSearchParams({ projectId: "test-project-id-2" });
			const res = await app.request("/logs?" + params, {
				method: "GET",
				headers: {
					Cookie: token,
				},
			});

			expect(res.status).toBe(200);
			const json = await res.json();
			expect(json.logs.length).toBe(1);
			expect(json.logs[0].projectId).toBe("test-project-id-2");
			expect(json.pagination).toBeDefined();
			expect(json.pagination.hasMore).toBe(false);
			expect(json.pagination.nextCursor).toBeNull();
			expect(json.pagination.limit).toBe(50);
		});

		test("should filter logs by model with a region-suffixed usedModel", async () => {
			// usedModel is stored as `provider/modelId[:region]`. The model filter
			// receives the bare model id, so the region suffix must be stripped.
			await db.insert(tables.log).values({
				id: "test-log-id-region",
				requestId: "test-log-id-region",
				organizationId: "test-org-id",
				projectId: "test-project-id",
				apiKeyId: "test-api-key-id",
				duration: 100,
				requestedModel: "claude-opus-4-6",
				requestedProvider: "aws-bedrock",
				usedModel: "aws-bedrock/claude-opus-4-6:global",
				usedProvider: "aws-bedrock",
				responseSize: 1000,
				content: "Test response with region-suffixed model",
				finishReason: "stop",
				promptTokens: "10",
				completionTokens: "20",
				totalTokens: "30",
				temperature: 0.7,
				maxTokens: 100,
				messages: JSON.stringify([{ role: "user", content: "Hello region" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			});

			const params = new URLSearchParams({
				projectId: "test-project-id",
				model: "claude-opus-4-6",
			});
			const res = await app.request("/logs?" + params, {
				method: "GET",
				headers: {
					Cookie: token,
				},
			});

			expect(res.status).toBe(200);
			const json = await res.json();
			expect(json.logs.length).toBe(1);
			expect(json.logs[0].id).toBe("test-log-id-region");
		});

		test("should filter logs by custom header", async () => {
			// First, add a log with a custom header
			await db.insert(tables.log).values({
				id: "test-log-id-custom-header",
				requestId: "test-log-id-custom-header",
				organizationId: "test-org-id",
				projectId: "test-project-id",
				apiKeyId: "test-api-key-id",
				duration: 100,
				requestedModel: "gpt-4",
				requestedProvider: "openai",
				usedModel: "gpt-4",
				usedProvider: "openai",
				responseSize: 1000,
				content: "Test response with custom header",
				finishReason: "stop",
				promptTokens: "10",
				completionTokens: "20",
				totalTokens: "30",
				temperature: 0.7,
				maxTokens: 100,
				messages: JSON.stringify([
					{ role: "user", content: "Hello with custom header" },
				]),
				mode: "api-keys",
				usedMode: "api-keys",
				customHeaders: { "test-header": "test-value" },
			});

			// Query logs with custom header filter
			const params = new URLSearchParams({
				customHeaderKey: "test-header",
				customHeaderValue: "test-value",
			});
			const res = await app.request("/logs?" + params, {
				method: "GET",
				headers: {
					Cookie: token,
				},
			});

			expect(res.status).toBe(200);
			const json = await res.json();
			expect(json.logs.length).toBe(1);
			expect(json.logs[0].id).toBe("test-log-id-custom-header");
			expect(json.logs[0].customHeaders).toEqual({
				"test-header": "test-value",
			});
			expect(json.pagination).toBeDefined();
			expect(json.pagination.hasMore).toBe(false);
			expect(json.pagination.nextCursor).toBeNull();
		});

		test("should sign video content URLs without relying on a specific model id", async () => {
			await db.insert(tables.log).values({
				id: "test-log-id-video",
				requestId: "test-log-id-video",
				organizationId: "test-org-id",
				projectId: "test-project-id",
				apiKeyId: "test-api-key-id",
				duration: 100,
				requestedModel: "future-video-model",
				requestedProvider: "example-video",
				usedModel: "future-video-model",
				usedProvider: "example-video",
				responseSize: 1000,
				content:
					"http://localhost:4001/v1/videos/logs/test-log-id-video/content",
				finishReason: "completed",
				unifiedFinishReason: "completed",
				videoOutputCost: 1.5,
				messages: JSON.stringify([{ role: "user", content: "Make a video" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			});

			const params = new URLSearchParams({ projectId: "test-project-id" });
			const res = await app.request("/logs?" + params, {
				method: "GET",
				headers: {
					Cookie: token,
				},
			});

			expect(res.status).toBe(200);
			const json = await res.json();
			const videoLog = json.logs.find(
				(log: { id: string; content: string | null }) =>
					log.id === "test-log-id-video",
			);

			expect(videoLog?.content).toMatch(
				/^http:\/\/localhost:4001\/v1\/videos\/logs\/test-log-id-video\/content\?token=/,
			);
		});
	});

	describe("unique models route", () => {
		test("should return providers from usedProvider and models from usedModel", async () => {
			const params = new URLSearchParams({ projectId: "test-project-id" });
			const res = await app.request("/logs/unique-models?" + params, {
				method: "GET",
				headers: {
					Cookie: token,
				},
			});

			expect(res.status).toBe(200);
			const json = await res.json();
			expect(json.models).toEqual(["gpt-4"]);
			expect(json.providers).toEqual(["openai"]);
		});

		test("should scope unique models and providers to the selected project", async () => {
			await db.insert(tables.log).values({
				id: "test-log-id-3",
				requestId: "test-log-id-3",
				organizationId: "test-org-id",
				projectId: "test-project-id",
				apiKeyId: "test-api-key-id",
				duration: 150,
				requestedModel: "openai/gpt-4o-mini",
				requestedProvider: "openai",
				usedModel: "openai/gpt-4o-mini",
				usedProvider: "openai",
				responseSize: 1500,
				content: "Test response content 3",
				finishReason: "stop",
				promptTokens: "15",
				completionTokens: "25",
				totalTokens: "40",
				temperature: 0.6,
				maxTokens: 150,
				messages: JSON.stringify([{ role: "user", content: "Hello 3" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			});

			const params = new URLSearchParams({ projectId: "test-project-id" });
			const res = await app.request("/logs/unique-models?" + params, {
				method: "GET",
				headers: {
					Cookie: token,
				},
			});

			expect(res.status).toBe(200);
			const json = await res.json();
			expect(json.models).toEqual(["gpt-4", "gpt-4o-mini"]);
			expect(json.providers).toEqual(["openai"]);
		});
	});

	// Tests for pagination functionality
	describe("pagination functionality", () => {
		beforeEach(async () => {
			// Add more logs for pagination testing with different timestamps
			const additionalLogs = [];
			const now = new Date();

			for (let i = 3; i <= 60; i++) {
				// Create logs with different timestamps, 1 minute apart
				// eslint-disable-next-line no-mixed-operators
				const createdAt = new Date(now.getTime() - i * 60 * 1000);

				additionalLogs.push({
					id: `test-log-id-${i}`,
					requestId: `test-log-id-${i}`,
					createdAt,
					updatedAt: createdAt,
					organizationId: "test-org-id",
					projectId: "test-project-id",
					apiKeyId: "test-api-key-id",
					duration: 100 + i,
					requestedModel: "gpt-4",
					requestedProvider: "openai",
					usedModel: "gpt-4",
					usedProvider: "openai",
					responseSize: 1000 + i,
					content: `Test response content ${i}`,
					finishReason: "stop",
					promptTokens: `${10 + i}`,
					completionTokens: `${20 + i}`,
					totalTokens: `${30 + i}`,
					temperature: 0.7,
					maxTokens: 100,
					messages: JSON.stringify([{ role: "user", content: `Hello ${i}` }]),
					mode: "api-keys",
					usedMode: "api-keys",
				} as const);
			}
			await db.insert(tables.log).values(additionalLogs);
		});

		test("should return default limit of 50 logs", async () => {
			const res = await app.request("/logs", {
				method: "GET",
				headers: {
					Cookie: token,
				},
			});

			expect(res.status).toBe(200);
			const json = await res.json();
			expect(json.logs.length).toBe(50);
			expect(json.pagination).toBeDefined();
			expect(json.pagination.hasMore).toBe(true);
			expect(json.pagination.nextCursor).toBeDefined();
			expect(json.pagination.limit).toBe(50);
		});

		test("should respect custom limit parameter", async () => {
			const params = new URLSearchParams({ limit: "10" });
			const res = await app.request("/logs?" + params, {
				method: "GET",
				headers: {
					Cookie: token,
				},
			});

			expect(res.status).toBe(200);
			const json = await res.json();
			expect(json.logs.length).toBe(10);
			expect(json.pagination).toBeDefined();
			expect(json.pagination.hasMore).toBe(true);
			expect(json.pagination.nextCursor).toBeDefined();
			expect(json.pagination.limit).toBe(10);
		});

		test("should paginate using cursor", async () => {
			// Get first page
			const firstPageRes = await app.request(
				"/logs?limit=10&projectId=test-project-id",
				{
					method: "GET",
					headers: {
						Cookie: token,
					},
				},
			);

			expect(firstPageRes.status).toBe(200);
			const firstPageJson = await firstPageRes.json();
			expect(firstPageJson.logs.length).toBe(10);
			expect(firstPageJson.pagination.hasMore).toBe(true);
			const cursor = firstPageJson.pagination.nextCursor;
			expect(cursor).toBeDefined();

			// Get second page using cursor
			const secondPageParams = new URLSearchParams({
				limit: "10",
				cursor: cursor,
				projectId: "test-project-id", // Explicitly specify the project ID
			});
			const secondPageRes = await app.request("/logs?" + secondPageParams, {
				method: "GET",
				headers: {
					Cookie: token,
				},
			});

			expect(secondPageRes.status).toBe(200);
			const secondPageJson = await secondPageRes.json();
			expect(secondPageJson.logs.length).toBe(10);

			// Ensure we got different logs in the second page
			const firstPageIds = new Set(
				firstPageJson.logs.map((log: any) => log.id),
			);
			const secondPageIds = new Set(
				secondPageJson.logs.map((log: any) => log.id),
			);

			// Check that there's no overlap between pages
			const intersection = [...firstPageIds].filter((id) =>
				secondPageIds.has(id),
			);
			expect(intersection.length).toBe(0);
		});
	});

	// internalErrorDetails stores the raw upstream error for stealth providers
	// and must never be returned by any public log endpoint, regardless of what
	// the UI chooses to display.
	describe("internal error details are never exposed", () => {
		const SECRET = "SecretVendor";

		beforeEach(async () => {
			await db.insert(tables.log).values({
				id: "stealth-error-log-id",
				requestId: "stealth-error-log-id",
				organizationId: "test-org-id",
				projectId: "test-project-id",
				apiKeyId: "test-api-key-id",
				duration: 100,
				requestedModel: "glm-5.2",
				requestedProvider: "glacier",
				usedModel: "glm-5.2",
				usedProvider: "glacier",
				responseSize: 0,
				finishReason: "upstream_error",
				unifiedFinishReason: "upstream_error",
				hasError: true,
				errorDetails: {
					statusCode: 500,
					statusText: "Internal Server Error",
					responseText: "Upstream provider error (500 Internal Server Error)",
				},
				internalErrorDetails: {
					statusCode: 500,
					statusText: `${SECRET} exploded`,
					responseText: `{"error":{"message":"${SECRET} quota exceeded on api.secretvendor.com"}}`,
				},
				messages: JSON.stringify([{ role: "user", content: "Hello" }]),
				mode: "credits",
				usedMode: "credits",
			});
		});

		test("list endpoint omits internalErrorDetails and its content", async () => {
			const params = new URLSearchParams({ projectId: "test-project-id" });
			const res = await app.request("/logs?" + params, {
				method: "GET",
				headers: {
					Cookie: token,
				},
			});

			expect(res.status).toBe(200);
			const text = await res.text();
			expect(text).not.toContain("internalErrorDetails");
			expect(text).not.toContain(SECRET);
			expect(text).not.toContain("secretvendor.com");

			const json = JSON.parse(text);
			const log = json.logs.find(
				(entry: { id: string }) => entry.id === "stealth-error-log-id",
			);
			expect(log).toBeTruthy();
			expect("internalErrorDetails" in log).toBe(false);
			// The redacted public error details are still served.
			expect(log.errorDetails).toEqual({
				statusCode: 500,
				statusText: "Internal Server Error",
				responseText: "Upstream provider error (500 Internal Server Error)",
			});
		});

		test("detail endpoint omits internalErrorDetails and its content", async () => {
			const res = await app.request("/logs/stealth-error-log-id", {
				method: "GET",
				headers: {
					Cookie: token,
				},
			});

			expect(res.status).toBe(200);
			const text = await res.text();
			expect(text).not.toContain("internalErrorDetails");
			expect(text).not.toContain(SECRET);
			expect(text).not.toContain("secretvendor.com");

			const json = JSON.parse(text);
			expect("internalErrorDetails" in json.log).toBe(false);
			expect(json.log.errorDetails.responseText).toBe(
				"Upstream provider error (500 Internal Server Error)",
			);
		});
	});

	// Network failures log a bare "fetch failed" message; the actual reason only
	// exists in the cause chain, so the public endpoints have to serve it for the
	// dashboard to show anything useful.
	describe("error cause is served to the dashboard", () => {
		const CAUSE =
			"HeadersTimeoutError: Headers Timeout Error (code: UND_ERR_HEADERS_TIMEOUT)";

		beforeEach(async () => {
			await db.insert(tables.log).values({
				id: "fetch-failed-log-id",
				requestId: "fetch-failed-log-id",
				organizationId: "test-org-id",
				projectId: "test-project-id",
				apiKeyId: "test-api-key-id",
				duration: 301880,
				requestedModel: "gpt-4",
				requestedProvider: "openai",
				usedModel: "gpt-4",
				usedProvider: "openai",
				responseSize: 0,
				finishReason: "upstream_error",
				unifiedFinishReason: "upstream_error",
				hasError: true,
				errorDetails: {
					statusCode: 0,
					statusText: "TypeError",
					responseText: "fetch failed",
					cause: CAUSE,
				},
				messages: JSON.stringify([{ role: "user", content: "Hello" }]),
				mode: "credits",
				usedMode: "credits",
			});
		});

		test("list endpoint serves the error cause", async () => {
			const params = new URLSearchParams({ projectId: "test-project-id" });
			const res = await app.request("/logs?" + params, {
				method: "GET",
				headers: {
					Cookie: token,
				},
			});

			expect(res.status).toBe(200);
			const json = await res.json();
			const log = json.logs.find(
				(entry: { id: string }) => entry.id === "fetch-failed-log-id",
			);
			expect(log.errorDetails.cause).toBe(CAUSE);
		});

		test("detail endpoint serves the error cause", async () => {
			const res = await app.request("/logs/fetch-failed-log-id", {
				method: "GET",
				headers: {
					Cookie: token,
				},
			});

			expect(res.status).toBe(200);
			const json = await res.json();
			expect(json.log.errorDetails).toEqual({
				statusCode: 0,
				statusText: "TypeError",
				responseText: "fetch failed",
				cause: CAUSE,
			});
		});
	});
	// Project access is not key access: a developer may only read logs produced by
	// the api keys they created, since the payload holds the full prompt and
	// completion.
	describe("developer key scoping", () => {
		const SECRET_PROMPT = "teammate-confidential-prompt";

		beforeEach(async () => {
			await db
				.update(tables.userOrganization)
				.set({ role: "developer" })
				.where(eq(tables.userOrganization.id, "test-user-org-id"));

			await db.insert(tables.userProject).values({
				id: "scoping-user-project-id",
				userOrganizationId: "test-user-org-id",
				projectId: "test-project-id",
			});

			await db.insert(tables.user).values({
				id: "teammate-id",
				name: "Teammate",
				email: "teammate@example.com",
				emailVerified: true,
			});

			await db.insert(tables.apiKey).values({
				id: "teammate-key",
				...hashApiKeyForStorage("teammate-token"),
				projectId: "test-project-id",
				description: "Teammate Key",
				createdBy: "teammate-id",
			});

			await db.insert(tables.log).values({
				id: "teammate-log-id",
				requestId: "teammate-log-id",
				organizationId: "test-org-id",
				projectId: "test-project-id",
				apiKeyId: "teammate-key",
				duration: 100,
				requestedModel: "gpt-4",
				requestedProvider: "openai",
				usedModel: "teammate-only-model",
				usedProvider: "openai",
				responseSize: 1000,
				content: "teammate response",
				promptTokens: "10",
				completionTokens: "20",
				totalTokens: "30",
				messages: JSON.stringify([{ role: "user", content: SECRET_PROMPT }]),
				mode: "api-keys",
				usedMode: "api-keys",
			});
		});

		test("list omits a teammate's logs and their payloads", async () => {
			const res = await app.request("/logs?projectId=test-project-id", {
				headers: { Cookie: token },
			});
			expect(res.status).toBe(200);
			const text = await res.text();
			expect(text).not.toContain(SECRET_PROMPT);

			const json = JSON.parse(text);
			const ids = json.logs.map((log: { id: string }) => log.id);
			expect(ids).not.toContain("teammate-log-id");
			expect(ids).toContain("test-log-id-1");
		});

		test("detail rejects a teammate's log", async () => {
			const res = await app.request("/logs/teammate-log-id", {
				headers: { Cookie: token },
			});
			expect(res.status).toBe(403);
			expect(await res.text()).not.toContain(SECRET_PROMPT);
		});

		test("detail still serves the caller's own log", async () => {
			const res = await app.request("/logs/test-log-id-1", {
				headers: { Cookie: token },
			});
			expect(res.status).toBe(200);
		});

		test("rejects filtering by a teammate's api key", async () => {
			const res = await app.request(
				"/logs?projectId=test-project-id&apiKeyId=teammate-key",
				{ headers: { Cookie: token } },
			);
			expect(res.status).toBe(403);
		});

		test("unique-models omits a teammate's models", async () => {
			const res = await app.request(
				"/logs/unique-models?projectId=test-project-id",
				{ headers: { Cookie: token } },
			);
			expect(res.status).toBe(200);
			const json = await res.json();
			expect(json.models).not.toContain("teammate-only-model");
		});

		test("owners still see the whole project", async () => {
			await db
				.update(tables.userOrganization)
				.set({ role: "owner" })
				.where(eq(tables.userOrganization.id, "test-user-org-id"));

			const res = await app.request("/logs?projectId=test-project-id", {
				headers: { Cookie: token },
			});
			expect(res.status).toBe(200);
			const json = await res.json();
			const ids = json.logs.map((log: { id: string }) => log.id);
			expect(ids).toContain("teammate-log-id");
		});
	});
});
