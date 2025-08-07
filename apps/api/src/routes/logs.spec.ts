import { db, tables } from "@llmgateway/db";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "..";
import { createTestUser, deleteAll } from "../testing";

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
			},
			{
				id: "test-org-id-2",
				name: "Test Organization 2",
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
				token: "test-token",
				projectId: "test-project-id",
				description: "Test API Key",
			},
			{
				id: "test-api-key-id-2",
				token: "test-token-2",
				projectId: "test-project-id-2",
				description: "Test API Key 2",
			},
		]);

		// Create test provider keys
		await db.insert(tables.providerKey).values([
			{
				id: "test-provider-key-id",
				token: "test-provider-token",
				provider: "openai",
				organizationId: "test-org-id",
			},
			{
				id: "test-provider-key-id-2",
				token: "test-provider-token-2",
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
	});

	// Tests for pagination functionality
	describe("pagination functionality", () => {
		beforeEach(async () => {
			// Add more logs for pagination testing with different timestamps
			const additionalLogs = [];
			const now = new Date();

			for (let i = 3; i <= 60; i++) {
				// Create logs with different timestamps, 1 minute apart
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
});
