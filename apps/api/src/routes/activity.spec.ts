import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import {
	createTestUser,
	deleteAll,
	aggregateLogsForTesting,
} from "@/testing.js";

import { db, tables } from "@llmgateway/db";

describe("activity endpoint", () => {
	let token: string;
	beforeEach(async () => {
		token = await createTestUser();

		await db.insert(tables.organization).values({
			id: "test-org-id",
			name: "Test Organization",
			billingEmail: "test@example.com",
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

		// Aggregate logs into the hourly stats tables for the activity endpoint
		await aggregateLogsForTesting();
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

	test("GET /activity should default to 7 days when no date params provided", async () => {
		const res = await app.request("/activity", {
			headers: {
				Authorization: "Bearer test-token",
				Cookie: token,
			},
		});

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(Array.isArray(data.activity)).toBe(true);
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

		await aggregateLogsForTesting();

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

	test("GET /activity should correctly calculate error rate", async () => {
		await db.delete(tables.log);

		const today = new Date();

		// Insert 5 logs: 2 with errors, 3 without errors
		await db.insert(tables.log).values([
			{
				id: "error-test-1",
				requestId: "error-test-1",
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
				hasError: true,
				messages: JSON.stringify([{ role: "user", content: "Test" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
			{
				id: "error-test-2",
				requestId: "error-test-2",
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
				hasError: true,
				messages: JSON.stringify([{ role: "user", content: "Test" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
			{
				id: "error-test-3",
				requestId: "error-test-3",
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
				hasError: false,
				messages: JSON.stringify([{ role: "user", content: "Test" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
			{
				id: "error-test-4",
				requestId: "error-test-4",
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
				hasError: false,
				messages: JSON.stringify([{ role: "user", content: "Test" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
			{
				id: "error-test-5",
				requestId: "error-test-5",
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
				hasError: false,
				messages: JSON.stringify([{ role: "user", content: "Test" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
		]);

		await aggregateLogsForTesting();

		const res = await app.request("/activity?days=7", {
			headers: {
				Cookie: token,
			},
		});

		expect(res.status).toBe(200);
		const data = await res.json();

		expect(data.activity.length).toBe(1);
		const todayData = data.activity[0];

		expect(todayData.requestCount).toBe(5);
		expect(todayData.errorCount).toBe(2);
		// Error rate = (2/5) * 100 = 40%
		expect(todayData.errorRate).toBeCloseTo(40, 2);
	});

	test("GET /activity should correctly calculate cache rate", async () => {
		await db.delete(tables.log);

		const today = new Date();

		// Insert 4 logs: 1 cached, 3 not cached
		await db.insert(tables.log).values([
			{
				id: "cache-test-1",
				requestId: "cache-test-1",
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
				cached: true,
				messages: JSON.stringify([{ role: "user", content: "Test" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
			{
				id: "cache-test-2",
				requestId: "cache-test-2",
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
				cached: false,
				messages: JSON.stringify([{ role: "user", content: "Test" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
			{
				id: "cache-test-3",
				requestId: "cache-test-3",
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
				cached: false,
				messages: JSON.stringify([{ role: "user", content: "Test" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
			{
				id: "cache-test-4",
				requestId: "cache-test-4",
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
				cached: false,
				messages: JSON.stringify([{ role: "user", content: "Test" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
		]);

		await aggregateLogsForTesting();

		const res = await app.request("/activity?days=7", {
			headers: {
				Cookie: token,
			},
		});

		expect(res.status).toBe(200);
		const data = await res.json();

		expect(data.activity.length).toBe(1);
		const todayData = data.activity[0];

		expect(todayData.requestCount).toBe(4);
		expect(todayData.cacheCount).toBe(1);
		// Cache rate = (1/4) * 100 = 25%
		expect(todayData.cacheRate).toBeCloseTo(25, 2);
	});

	test("GET /activity should correctly calculate discount savings", async () => {
		await db.delete(tables.log);

		const today = new Date();

		// Insert logs with discounts
		// If discounted cost = cost and discount = 0.2, then:
		// original_cost = cost / (1 - discount) = cost / 0.8
		// savings = original_cost - cost = cost / 0.8 - cost = cost * 0.2 / 0.8 = cost * discount / (1 - discount)
		await db.insert(tables.log).values([
			{
				id: "discount-test-1",
				requestId: "discount-test-1",
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
				cost: 0.8, // After 20% discount, original was 1.0
				discount: 0.2, // 20% discount
				messages: JSON.stringify([{ role: "user", content: "Test" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
			{
				id: "discount-test-2",
				requestId: "discount-test-2",
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
				cost: 0.5, // After 50% discount, original was 1.0
				discount: 0.5, // 50% discount
				messages: JSON.stringify([{ role: "user", content: "Test" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
			{
				id: "discount-test-3",
				requestId: "discount-test-3",
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
				cost: 1.0, // No discount
				discount: 0, // No discount
				messages: JSON.stringify([{ role: "user", content: "Test" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
		]);

		await aggregateLogsForTesting();

		const res = await app.request("/activity?days=7", {
			headers: {
				Cookie: token,
			},
		});

		expect(res.status).toBe(200);
		const data = await res.json();

		expect(data.activity.length).toBe(1);
		const todayData = data.activity[0];

		// Savings calculation:
		// Log 1: cost=0.8, discount=0.2, savings = 0.8 * 0.2 / (1 - 0.2) = 0.8 * 0.2 / 0.8 = 0.2
		// Log 2: cost=0.5, discount=0.5, savings = 0.5 * 0.5 / (1 - 0.5) = 0.5 * 0.5 / 0.5 = 0.5
		// Log 3: cost=1.0, discount=0, savings = 0 (no discount)
		// Total savings = 0.2 + 0.5 + 0 = 0.7
		expect(todayData.discountSavings).toBeCloseTo(0.7, 2);
	});

	test("GET /activity should correctly aggregate cost breakdown (inputCost, outputCost, requestCost)", async () => {
		await db.delete(tables.log);

		const today = new Date();

		await db.insert(tables.log).values([
			{
				id: "cost-test-1",
				requestId: "cost-test-1",
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
				promptTokens: "100",
				completionTokens: "200",
				totalTokens: "300",
				cost: 0.35,
				inputCost: 0.1,
				outputCost: 0.2,
				requestCost: 0.05,
				messages: JSON.stringify([{ role: "user", content: "Test" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
			{
				id: "cost-test-2",
				requestId: "cost-test-2",
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
				promptTokens: "150",
				completionTokens: "250",
				totalTokens: "400",
				cost: 0.45,
				inputCost: 0.15,
				outputCost: 0.25,
				requestCost: 0.05,
				messages: JSON.stringify([{ role: "user", content: "Test" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
			{
				id: "cost-test-3",
				requestId: "cost-test-3",
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
				promptTokens: "200",
				completionTokens: "300",
				totalTokens: "500",
				cost: 0.6,
				inputCost: 0.2,
				outputCost: 0.3,
				requestCost: 0.1,
				messages: JSON.stringify([{ role: "user", content: "Test" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
		]);

		await aggregateLogsForTesting();

		const res = await app.request("/activity?days=7", {
			headers: {
				Cookie: token,
			},
		});

		expect(res.status).toBe(200);
		const data = await res.json();

		expect(data.activity.length).toBe(1);
		const todayData = data.activity[0];

		expect(todayData.requestCount).toBe(3);
		// Total cost = 0.35 + 0.45 + 0.6 = 1.4
		expect(todayData.cost).toBeCloseTo(1.4, 2);
		// Input cost = 0.1 + 0.15 + 0.2 = 0.45
		expect(todayData.inputCost).toBeCloseTo(0.45, 2);
		// Output cost = 0.2 + 0.25 + 0.3 = 0.75
		expect(todayData.outputCost).toBeCloseTo(0.75, 2);
		// Request cost = 0.05 + 0.05 + 0.1 = 0.2
		expect(todayData.requestCost).toBeCloseTo(0.2, 2);
	});

	test("GET /activity should return zero error rate and cache rate when no requests", async () => {
		await db.delete(tables.log);
		await aggregateLogsForTesting();

		const res = await app.request("/activity?days=7", {
			headers: {
				Cookie: token,
			},
		});

		expect(res.status).toBe(200);
		const data = await res.json();

		// When there are no logs, the activity array should be empty
		expect(data.activity.length).toBe(0);
	});

	test("GET /activity should correctly calculate model breakdown aggregations", async () => {
		await db.delete(tables.log);

		const today = new Date();

		// Insert multiple logs for different models on the same day
		await db.insert(tables.log).values([
			{
				id: "model-breakdown-1",
				requestId: "model-breakdown-1",
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
				promptTokens: "100",
				completionTokens: "200",
				totalTokens: "300",
				cost: 0.5,
				messages: JSON.stringify([{ role: "user", content: "Test" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
			{
				id: "model-breakdown-2",
				requestId: "model-breakdown-2",
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
				promptTokens: "150",
				completionTokens: "250",
				totalTokens: "400",
				cost: 0.7,
				messages: JSON.stringify([{ role: "user", content: "Test" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
			{
				id: "model-breakdown-3",
				requestId: "model-breakdown-3",
				createdAt: today,
				updatedAt: today,
				organizationId: "test-org-id",
				projectId: "test-project-id",
				apiKeyId: "test-api-key-id",
				duration: 100,
				requestedModel: "claude-3-sonnet",
				requestedProvider: "anthropic",
				usedModel: "claude-3-sonnet",
				usedProvider: "anthropic",
				responseSize: 1000,
				promptTokens: "200",
				completionTokens: "300",
				totalTokens: "500",
				cost: 0.8,
				messages: JSON.stringify([{ role: "user", content: "Test" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
		]);

		await aggregateLogsForTesting();

		const res = await app.request("/activity?days=7", {
			headers: {
				Cookie: token,
			},
		});

		expect(res.status).toBe(200);
		const data = await res.json();

		expect(data.activity.length).toBe(1);
		const todayData = data.activity[0];

		// Should have 2 models in breakdown
		expect(todayData.modelBreakdown.length).toBe(2);

		// Find gpt-4 model data
		const gpt4Data = todayData.modelBreakdown.find(
			(m: any) => m.id === "gpt-4",
		);
		expect(gpt4Data).toBeDefined();
		expect(gpt4Data.provider).toBe("openai");
		expect(gpt4Data.requestCount).toBe(2);
		expect(gpt4Data.inputTokens).toBe(250); // 100 + 150
		expect(gpt4Data.outputTokens).toBe(450); // 200 + 250
		expect(gpt4Data.totalTokens).toBe(700); // 300 + 400
		expect(gpt4Data.cost).toBeCloseTo(1.2, 2); // 0.5 + 0.7

		// Find claude model data
		const claudeData = todayData.modelBreakdown.find(
			(m: any) => m.id === "claude-3-sonnet",
		);
		expect(claudeData).toBeDefined();
		expect(claudeData.provider).toBe("anthropic");
		expect(claudeData.requestCount).toBe(1);
		expect(claudeData.inputTokens).toBe(200);
		expect(claudeData.outputTokens).toBe(300);
		expect(claudeData.totalTokens).toBe(500);
		expect(claudeData.cost).toBeCloseTo(0.8, 2);
	});

	test("GET /activity should handle 100% error rate correctly", async () => {
		await db.delete(tables.log);

		const today = new Date();

		// Insert only error logs
		await db.insert(tables.log).values([
			{
				id: "all-errors-1",
				requestId: "all-errors-1",
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
				responseSize: 0,
				promptTokens: "10",
				completionTokens: "0",
				totalTokens: "10",
				hasError: true,
				messages: JSON.stringify([{ role: "user", content: "Test" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
			{
				id: "all-errors-2",
				requestId: "all-errors-2",
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
				responseSize: 0,
				promptTokens: "10",
				completionTokens: "0",
				totalTokens: "10",
				hasError: true,
				messages: JSON.stringify([{ role: "user", content: "Test" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
		]);

		await aggregateLogsForTesting();

		const res = await app.request("/activity?days=7", {
			headers: {
				Cookie: token,
			},
		});

		expect(res.status).toBe(200);
		const data = await res.json();

		expect(data.activity.length).toBe(1);
		const todayData = data.activity[0];

		expect(todayData.requestCount).toBe(2);
		expect(todayData.errorCount).toBe(2);
		expect(todayData.errorRate).toBeCloseTo(100, 2);
	});

	test("GET /activity should handle 100% cache rate correctly", async () => {
		await db.delete(tables.log);

		const today = new Date();

		// Insert only cached logs
		await db.insert(tables.log).values([
			{
				id: "all-cached-1",
				requestId: "all-cached-1",
				createdAt: today,
				updatedAt: today,
				organizationId: "test-org-id",
				projectId: "test-project-id",
				apiKeyId: "test-api-key-id",
				duration: 5,
				requestedModel: "gpt-4",
				requestedProvider: "openai",
				usedModel: "gpt-4",
				usedProvider: "openai",
				responseSize: 1000,
				promptTokens: "10",
				completionTokens: "20",
				totalTokens: "30",
				cached: true,
				messages: JSON.stringify([{ role: "user", content: "Test" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
			{
				id: "all-cached-2",
				requestId: "all-cached-2",
				createdAt: today,
				updatedAt: today,
				organizationId: "test-org-id",
				projectId: "test-project-id",
				apiKeyId: "test-api-key-id",
				duration: 5,
				requestedModel: "gpt-4",
				requestedProvider: "openai",
				usedModel: "gpt-4",
				usedProvider: "openai",
				responseSize: 1000,
				promptTokens: "10",
				completionTokens: "20",
				totalTokens: "30",
				cached: true,
				messages: JSON.stringify([{ role: "user", content: "Test" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
			{
				id: "all-cached-3",
				requestId: "all-cached-3",
				createdAt: today,
				updatedAt: today,
				organizationId: "test-org-id",
				projectId: "test-project-id",
				apiKeyId: "test-api-key-id",
				duration: 5,
				requestedModel: "gpt-4",
				requestedProvider: "openai",
				usedModel: "gpt-4",
				usedProvider: "openai",
				responseSize: 1000,
				promptTokens: "10",
				completionTokens: "20",
				totalTokens: "30",
				cached: true,
				messages: JSON.stringify([{ role: "user", content: "Test" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
		]);

		await aggregateLogsForTesting();

		const res = await app.request("/activity?days=7", {
			headers: {
				Cookie: token,
			},
		});

		expect(res.status).toBe(200);
		const data = await res.json();

		expect(data.activity.length).toBe(1);
		const todayData = data.activity[0];

		expect(todayData.requestCount).toBe(3);
		expect(todayData.cacheCount).toBe(3);
		expect(todayData.cacheRate).toBeCloseTo(100, 2);
	});

	test("GET /activity should handle edge case with discount = 1 (invalid, should be excluded)", async () => {
		await db.delete(tables.log);

		const today = new Date();

		// The SQL formula excludes discount >= 1 or discount <= 0
		// discount = 1 would cause division by zero, so it's excluded
		await db.insert(tables.log).values([
			{
				id: "edge-discount-1",
				requestId: "edge-discount-1",
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
				cost: 0.5,
				discount: 1, // Invalid discount (would cause division by zero)
				messages: JSON.stringify([{ role: "user", content: "Test" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
			{
				id: "edge-discount-2",
				requestId: "edge-discount-2",
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
				cost: 0.8,
				discount: 0.2, // Valid discount
				messages: JSON.stringify([{ role: "user", content: "Test" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
		]);

		await aggregateLogsForTesting();

		const res = await app.request("/activity?days=7", {
			headers: {
				Cookie: token,
			},
		});

		expect(res.status).toBe(200);
		const data = await res.json();

		expect(data.activity.length).toBe(1);
		const todayData = data.activity[0];

		// Only the valid discount should contribute to savings
		// savings = 0.8 * 0.2 / (1 - 0.2) = 0.8 * 0.2 / 0.8 = 0.2
		expect(todayData.discountSavings).toBeCloseTo(0.2, 2);
	});

	test("GET /activity should handle null/undefined cost values correctly", async () => {
		await db.delete(tables.log);

		const today = new Date();

		// Insert logs with null/undefined cost values
		await db.insert(tables.log).values([
			{
				id: "null-cost-1",
				requestId: "null-cost-1",
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
				promptTokens: "100",
				completionTokens: "200",
				totalTokens: "300",
				// cost, inputCost, outputCost, requestCost all null/undefined
				messages: JSON.stringify([{ role: "user", content: "Test" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
			{
				id: "null-cost-2",
				requestId: "null-cost-2",
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
				promptTokens: "100",
				completionTokens: "200",
				totalTokens: "300",
				cost: 0.5,
				inputCost: 0.2,
				outputCost: 0.25,
				requestCost: 0.05,
				messages: JSON.stringify([{ role: "user", content: "Test" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
		]);

		await aggregateLogsForTesting();

		const res = await app.request("/activity?days=7", {
			headers: {
				Cookie: token,
			},
		});

		expect(res.status).toBe(200);
		const data = await res.json();

		expect(data.activity.length).toBe(1);
		const todayData = data.activity[0];

		// COALESCE should treat nulls as 0
		expect(todayData.cost).toBeCloseTo(0.5, 2);
		expect(todayData.inputCost).toBeCloseTo(0.2, 2);
		expect(todayData.outputCost).toBeCloseTo(0.25, 2);
		expect(todayData.requestCost).toBeCloseTo(0.05, 2);
	});

	test("GET /activity should correctly aggregate across multiple days", async () => {
		await db.delete(tables.log);

		const today = new Date();
		const yesterday = new Date(today);
		yesterday.setDate(yesterday.getDate() - 1);
		const twoDaysAgo = new Date(today);
		twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

		await db.insert(tables.log).values([
			// Today: 2 requests, 1 error, 1 cached
			{
				id: "multi-day-1",
				requestId: "multi-day-1",
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
				promptTokens: "100",
				completionTokens: "200",
				totalTokens: "300",
				cost: 0.5,
				hasError: true,
				cached: false,
				messages: JSON.stringify([{ role: "user", content: "Test" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
			{
				id: "multi-day-2",
				requestId: "multi-day-2",
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
				promptTokens: "50",
				completionTokens: "100",
				totalTokens: "150",
				cost: 0.3,
				hasError: false,
				cached: true,
				messages: JSON.stringify([{ role: "user", content: "Test" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
			// Yesterday: 3 requests, 0 errors, 2 cached
			{
				id: "multi-day-3",
				requestId: "multi-day-3",
				createdAt: yesterday,
				updatedAt: yesterday,
				organizationId: "test-org-id",
				projectId: "test-project-id",
				apiKeyId: "test-api-key-id",
				duration: 100,
				requestedModel: "gpt-4",
				requestedProvider: "openai",
				usedModel: "gpt-4",
				usedProvider: "openai",
				responseSize: 1000,
				promptTokens: "200",
				completionTokens: "300",
				totalTokens: "500",
				cost: 0.7,
				hasError: false,
				cached: true,
				messages: JSON.stringify([{ role: "user", content: "Test" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
			{
				id: "multi-day-4",
				requestId: "multi-day-4",
				createdAt: yesterday,
				updatedAt: yesterday,
				organizationId: "test-org-id",
				projectId: "test-project-id",
				apiKeyId: "test-api-key-id",
				duration: 100,
				requestedModel: "gpt-4",
				requestedProvider: "openai",
				usedModel: "gpt-4",
				usedProvider: "openai",
				responseSize: 1000,
				promptTokens: "150",
				completionTokens: "250",
				totalTokens: "400",
				cost: 0.6,
				hasError: false,
				cached: true,
				messages: JSON.stringify([{ role: "user", content: "Test" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
			{
				id: "multi-day-5",
				requestId: "multi-day-5",
				createdAt: yesterday,
				updatedAt: yesterday,
				organizationId: "test-org-id",
				projectId: "test-project-id",
				apiKeyId: "test-api-key-id",
				duration: 100,
				requestedModel: "gpt-4",
				requestedProvider: "openai",
				usedModel: "gpt-4",
				usedProvider: "openai",
				responseSize: 1000,
				promptTokens: "100",
				completionTokens: "100",
				totalTokens: "200",
				cost: 0.4,
				hasError: false,
				cached: false,
				messages: JSON.stringify([{ role: "user", content: "Test" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
			// Two days ago: 1 request, 1 error, 0 cached
			{
				id: "multi-day-6",
				requestId: "multi-day-6",
				createdAt: twoDaysAgo,
				updatedAt: twoDaysAgo,
				organizationId: "test-org-id",
				projectId: "test-project-id",
				apiKeyId: "test-api-key-id",
				duration: 100,
				requestedModel: "gpt-4",
				requestedProvider: "openai",
				usedModel: "gpt-4",
				usedProvider: "openai",
				responseSize: 0,
				promptTokens: "50",
				completionTokens: "0",
				totalTokens: "50",
				cost: 0.1,
				hasError: true,
				cached: false,
				messages: JSON.stringify([{ role: "user", content: "Test" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
		]);

		await aggregateLogsForTesting();

		const res = await app.request("/activity?days=7", {
			headers: {
				Cookie: token,
			},
		});

		expect(res.status).toBe(200);
		const data = await res.json();

		expect(data.activity.length).toBe(3);

		// Find each day's data
		const todayData = data.activity.find(
			(d: any) => d.requestCount === 2 && d.errorCount === 1,
		);
		const yesterdayData = data.activity.find(
			(d: any) => d.requestCount === 3 && d.cacheCount === 2,
		);
		const twoDaysAgoData = data.activity.find(
			(d: any) => d.requestCount === 1 && d.errorCount === 1,
		);

		// Today: 2 requests, 1 error (50%), 1 cached (50%)
		expect(todayData).toBeDefined();
		expect(todayData.errorRate).toBeCloseTo(50, 2);
		expect(todayData.cacheRate).toBeCloseTo(50, 2);
		expect(todayData.totalTokens).toBe(450); // 300 + 150
		expect(todayData.cost).toBeCloseTo(0.8, 2); // 0.5 + 0.3

		// Yesterday: 3 requests, 0 errors (0%), 2 cached (66.67%)
		expect(yesterdayData).toBeDefined();
		expect(yesterdayData.errorRate).toBeCloseTo(0, 2);
		expect(yesterdayData.cacheRate).toBeCloseTo(66.67, 1);
		expect(yesterdayData.totalTokens).toBe(1100); // 500 + 400 + 200
		expect(yesterdayData.cost).toBeCloseTo(1.7, 2); // 0.7 + 0.6 + 0.4

		// Two days ago: 1 request, 1 error (100%), 0 cached (0%)
		expect(twoDaysAgoData).toBeDefined();
		expect(twoDaysAgoData.errorRate).toBeCloseTo(100, 2);
		expect(twoDaysAgoData.cacheRate).toBeCloseTo(0, 2);
		expect(twoDaysAgoData.totalTokens).toBe(50);
		expect(twoDaysAgoData.cost).toBeCloseTo(0.1, 2);
	});
});
