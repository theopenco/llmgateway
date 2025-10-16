import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

describe("activity endpoint", () => {
	let token: string;
	beforeEach(async () => {
		token = await createTestUser();

		await db.insert(tables.organization).values({
			id: "test-org-id",
			name: "Test Organization",
		});

		await db.insert(tables.userOrganization).values({
			id: "test-user-org-id",
			userId: "test-user-id",
			organizationId: "test-org-id",
		});

		await db.insert(tables.project).values([
			{
				id: "test-project-id",
				name: "Test Project",
				organizationId: "test-org-id",
			},
			{
				id: "test-project-id-2",
				name: "Test Project 2",
				organizationId: "test-org-id",
			},
		]);

		await db.insert(tables.apiKey).values([
			{
				id: "test-api-key-id",
				token: "test-token",
				projectId: "test-project-id",
				description: "Test API Key",
				createdBy: "test-user-id",
			},
			{
				id: "test-api-key-id-2",
				token: "test-token-2",
				projectId: "test-project-id-2",
				description: "Test API Key 2",
				createdBy: "test-user-id",
			},
		]);

		await db.insert(tables.providerKey).values({
			id: "test-provider-key-id",
			token: "test-provider-token",
			provider: "openai",
			organizationId: "test-org-id",
		});

		// Insert some log entries with different dates
		const today = new Date();
		const yesterday = new Date(today);
		yesterday.setDate(yesterday.getDate() - 1);
		const twoDaysAgo = new Date(today);
		twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

		await db.insert(tables.log).values([
			{
				id: "log-1",
				requestId: "log-1",
				createdAt: today,
				updatedAt: today,
				organizationId: "test-org-id",
				projectId: "test-project-id",
				apiKeyId: "test-api-key-id",
				duration: 100,
				requestedModel: "gpt-4",
				requestedProvider: "openai",
				usedModel: "gpt-4",
				usedProvider: "openai",
				responseSize: 1000,
				promptTokens: "10",
				completionTokens: "20",
				totalTokens: "30",
				messages: JSON.stringify([{ role: "user", content: "Hello" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
			{
				id: "log-2",
				requestId: "log-2",
				createdAt: today,
				updatedAt: today,
				organizationId: "test-org-id",
				projectId: "test-project-id",
				apiKeyId: "test-api-key-id",
				duration: 200,
				requestedModel: "gpt-3.5-turbo",
				requestedProvider: "openai",
				usedModel: "gpt-3.5-turbo",
				usedProvider: "openai",
				responseSize: 800,
				promptTokens: "5",
				completionTokens: "15",
				totalTokens: "20",
				messages: JSON.stringify([{ role: "user", content: "Hi" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
			{
				id: "log-3",
				requestId: "log-3",
				createdAt: yesterday,
				updatedAt: yesterday,
				organizationId: "test-org-id",
				projectId: "test-project-id",
				apiKeyId: "test-api-key-id",
				duration: 150,
				requestedModel: "gpt-4",
				requestedProvider: "openai",
				usedModel: "gpt-4",
				usedProvider: "openai",
				responseSize: 1200,
				promptTokens: "15",
				completionTokens: "25",
				totalTokens: "40",
				messages: JSON.stringify([{ role: "user", content: "Test" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
			{
				id: "log-4",
				requestId: "log-4",
				createdAt: twoDaysAgo,
				updatedAt: twoDaysAgo,
				organizationId: "test-org-id",
				projectId: "test-project-id",
				apiKeyId: "test-api-key-id",
				duration: 180,
				requestedModel: "gpt-3.5-turbo",
				requestedProvider: "openai",
				usedModel: "gpt-3.5-turbo",
				usedProvider: "openai",
				responseSize: 900,
				promptTokens: "8",
				completionTokens: "18",
				totalTokens: "26",
				messages: JSON.stringify([{ role: "user", content: "Query" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
			{
				id: "log-5",
				requestId: "log-5",
				createdAt: today,
				updatedAt: today,
				organizationId: "test-org-id",
				projectId: "test-project-id-2",
				apiKeyId: "test-api-key-id-2",
				duration: 50,
				requestedModel: "gpt-4",
				requestedProvider: "openai",
				usedModel: "gpt-4",
				usedProvider: "openai",
				responseSize: 500,
				promptTokens: "4",
				completionTokens: "6",
				totalTokens: "10",
				messages: JSON.stringify([{ role: "user", content: "Another" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
		]);
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("GET /activity should return activity data grouped by day", async () => {
		// Mock authentication
		const res = await app.request("/activity?days=7", {
			headers: {
				Cookie: token,
			},
		});

		expect(res.status).toBe(200);
		const data = await res.json();

		expect(data).toHaveProperty("activity");
		expect(Array.isArray(data.activity)).toBe(true);
		expect(data.activity.length).toBe(3); // Today, yesterday, and two days ago

		// Check structure of the response
		const firstDay = data.activity[0];
		expect(firstDay).toHaveProperty("date");
		expect(firstDay).toHaveProperty("requestCount");
		expect(firstDay).toHaveProperty("inputTokens");
		expect(firstDay).toHaveProperty("outputTokens");
		expect(firstDay).toHaveProperty("totalTokens");
		expect(firstDay).toHaveProperty("cost");
		expect(firstDay).toHaveProperty("modelBreakdown");
		expect(Array.isArray(firstDay.modelBreakdown)).toBe(true);

		// Check model breakdown
		const modelData = firstDay.modelBreakdown[0];
		expect(modelData).toHaveProperty("id");
		expect(modelData).toHaveProperty("provider");
		expect(modelData).toHaveProperty("requestCount");
		expect(modelData).toHaveProperty("inputTokens");
		expect(modelData).toHaveProperty("outputTokens");
		expect(modelData).toHaveProperty("totalTokens");
		expect(modelData).toHaveProperty("cost");
	});

	test("GET /activity should filter by projectId", async () => {
		const params = new URLSearchParams({
			days: "7",
			projectId: "test-project-id-2",
		});
		const res = await app.request("/activity?" + params, {
			headers: {
				Cookie: token,
			},
		});

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(Array.isArray(data.activity)).toBe(true);
		expect(data.activity.length).toBe(1);
	});

	test("GET /activity should require days parameter", async () => {
		const res = await app.request("/activity", {
			headers: {
				Authorization: "Bearer test-token",
				Cookie: token,
			},
		});

		expect(res.status).toBe(400);
	});

	test("GET /activity should require authentication", async () => {
		const res = await app.request("/activity?days=7");
		expect(res.status).toBe(401);
	});

	test("GET /activity should correctly aggregate token counts", async () => {
		// Clear existing logs and insert test data with known values
		await db.delete(tables.log);

		const today = new Date();
		const yesterday = new Date(today);
		yesterday.setDate(yesterday.getDate() - 1);

		await db.insert(tables.log).values([
			{
				id: "token-test-1",
				requestId: "token-test-1",
				createdAt: today,
				updatedAt: today,
				organizationId: "test-org-id",
				projectId: "test-project-id",
				apiKeyId: "test-api-key-id",
				duration: 1000,
				requestedModel: "gpt-4",
				requestedProvider: "openai",
				usedModel: "gpt-4",
				usedProvider: "openai",
				responseSize: 1000,
				promptTokens: "100",
				completionTokens: "200",
				totalTokens: "300",
				cost: 0.1,
				inputCost: 0.05,
				outputCost: 0.05,
				requestCost: 0,
				messages: JSON.stringify([{ role: "user", content: "Test" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
			{
				id: "token-test-2",
				requestId: "token-test-2",
				createdAt: today,
				updatedAt: today,
				organizationId: "test-org-id",
				projectId: "test-project-id",
				apiKeyId: "test-api-key-id",
				duration: 1500,
				requestedModel: "gpt-4",
				requestedProvider: "openai",
				usedModel: "gpt-4",
				usedProvider: "openai",
				responseSize: 1500,
				promptTokens: "150",
				completionTokens: "250",
				totalTokens: "400",
				cost: 0.15,
				inputCost: 0.07,
				outputCost: 0.08,
				requestCost: 0,
				messages: JSON.stringify([{ role: "user", content: "Test2" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
			{
				id: "token-test-3",
				requestId: "token-test-3",
				createdAt: yesterday,
				updatedAt: yesterday,
				organizationId: "test-org-id",
				projectId: "test-project-id",
				apiKeyId: "test-api-key-id",
				duration: 2000,
				requestedModel: "claude-3-sonnet",
				requestedProvider: "anthropic",
				usedModel: "claude-3-sonnet",
				usedProvider: "anthropic",
				responseSize: 2000,
				promptTokens: "300",
				completionTokens: "500",
				totalTokens: "800",
				cost: 0.25,
				inputCost: 0.1,
				outputCost: 0.15,
				requestCost: 0,
				messages: JSON.stringify([{ role: "user", content: "Test3" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
		]);

		const res = await app.request("/activity?days=7", {
			headers: {
				Cookie: token,
			},
		});

		expect(res.status).toBe(200);
		const data = await res.json();

		// Verify the response structure
		expect(Array.isArray(data.activity)).toBe(true);
		expect(data.activity.length).toBeGreaterThan(0);

		// Calculate totals from the response
		const totalRequests = data.activity.reduce(
			(sum: number, day: any) => sum + day.requestCount,
			0,
		);
		const totalTokens = data.activity.reduce(
			(sum: number, day: any) => sum + day.totalTokens,
			0,
		);
		const totalInputTokens = data.activity.reduce(
			(sum: number, day: any) => sum + day.inputTokens,
			0,
		);
		const totalOutputTokens = data.activity.reduce(
			(sum: number, day: any) => sum + day.outputTokens,
			0,
		);
		const totalCost = data.activity.reduce(
			(sum: number, day: any) => sum + day.cost,
			0,
		);

		// Verify correct aggregation
		expect(totalRequests).toBe(3);
		expect(totalTokens).toBe(1500); // 300 + 400 + 800
		expect(totalInputTokens).toBe(550); // 100 + 150 + 300
		expect(totalOutputTokens).toBe(950); // 200 + 250 + 500
		expect(totalCost).toBeCloseTo(0.5, 2); // 0.10 + 0.15 + 0.25

		// Verify individual days
		const todayData = data.activity.find((day: any) => day.requestCount === 2);
		const yesterdayData = data.activity.find(
			(day: any) => day.requestCount === 1,
		);

		expect(todayData).toBeDefined();
		expect(todayData.totalTokens).toBe(700); // 300 + 400
		expect(todayData.inputTokens).toBe(250); // 100 + 150
		expect(todayData.outputTokens).toBe(450); // 200 + 250

		expect(yesterdayData).toBeDefined();
		expect(yesterdayData.totalTokens).toBe(800);
		expect(yesterdayData.inputTokens).toBe(300);
		expect(yesterdayData.outputTokens).toBe(500);
	});
});
