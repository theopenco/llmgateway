import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";
import {
	mcpAccountSchema,
	mcpUsageSchema,
	mcpUsageBreakdownSchema,
} from "@llmgateway/shared";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

const period = { from: "2026-03-01", to: "2026-03-02" };
const hour = new Date("2026-03-01T10:00:00Z");

describe("MCP account analytics", () => {
	beforeEach(async () => {
		await deleteAll();
		await db.insert(tables.user).values([
			{ id: "mcp-owner", email: "owner@example.com", name: "Owner" },
			{ id: "mcp-member", email: "member@example.com", name: "Developer" },
		]);
		await db.insert(tables.organization).values([
			{
				id: "mcp-org",
				name: "Test Organization",
				billingEmail: "admin@example.com",
				retentionLevel: "none",
				credits: "100",
			},
			{
				id: "mcp-other-org",
				name: "Other Organization",
				billingEmail: "other@example.com",
			},
		]);
		await db.insert(tables.userOrganization).values([
			{
				id: "mcp-owner-membership",
				userId: "mcp-owner",
				organizationId: "mcp-org",
				role: "owner",
			},
			{
				id: "mcp-member-membership",
				userId: "mcp-member",
				organizationId: "mcp-org",
				role: "developer",
			},
		]);
		await db.insert(tables.project).values([
			{ id: "mcp-project", name: "Test Project", organizationId: "mcp-org" },
			{ id: "mcp-sibling", name: "Sibling Project", organizationId: "mcp-org" },
			{
				id: "mcp-other-project",
				name: "Other Project",
				organizationId: "mcp-other-org",
			},
		]);
		await db.insert(tables.userProject).values({
			userOrganizationId: "mcp-member-membership",
			projectId: "mcp-project",
		});
		await db.insert(tables.apiKey).values([
			{
				id: "mcp-owner-key",
				...hashApiKeyForStorage("mcp-owner-token"),
				projectId: "mcp-project",
				createdBy: "mcp-owner",
				description: "Owner key",
			},
			{
				id: "mcp-member-key",
				...hashApiKeyForStorage("mcp-member-token"),
				projectId: "mcp-project",
				createdBy: "mcp-member",
				description: "Developer key",
			},
			{
				id: "mcp-member-old-key",
				...hashApiKeyForStorage("mcp-old-token"),
				projectId: "mcp-project",
				createdBy: "mcp-member",
				description: "Old key",
				status: "inactive",
			},
		]);
		await db.insert(tables.projectHourlyStats).values([
			{
				projectId: "mcp-project",
				hourTimestamp: hour,
				requestCount: 30,
				cost: 4,
				creditsCost: 3,
				apiKeysCost: 1,
				dataStorageCost: 0.25,
				inputTokens: "400",
				outputTokens: "200",
				totalTokens: "600",
				errorCount: 2,
				cacheCount: 3,
			},
			{
				projectId: "mcp-project",
				hourTimestamp: new Date("2026-03-03T00:00:00Z"),
				requestCount: 999,
				cost: 999,
			},
			{
				projectId: "mcp-sibling",
				hourTimestamp: hour,
				requestCount: 888,
				cost: 888,
			},
			{
				projectId: "mcp-other-project",
				hourTimestamp: hour,
				requestCount: 777,
				cost: 777,
			},
		]);
		await db.insert(tables.projectHourlyModelStats).values([
			{
				projectId: "mcp-project",
				hourTimestamp: hour,
				usedProvider: "provider-a",
				usedModel: "model-a",
				requestCount: 10,
				cost: 1,
				totalTokens: "100",
			},
			{
				projectId: "mcp-project",
				hourTimestamp: hour,
				usedProvider: "provider-a",
				usedModel: "model-b",
				requestCount: 6,
				cost: 1,
				totalTokens: "100",
			},
			{
				projectId: "mcp-project",
				hourTimestamp: hour,
				usedProvider: "provider-b",
				usedModel: "model-b",
				requestCount: 14,
				cost: 2,
				totalTokens: "400",
			},
		]);
		await db.insert(tables.projectHourlySourceStats).values([
			{
				projectId: "mcp-project",
				hourTimestamp: hour,
				source: "opencode",
				requestCount: 10,
				cost: 1,
			},
			{
				projectId: "mcp-project",
				hourTimestamp: hour,
				source: "open-code",
				requestCount: 8,
				cost: 1,
			},
			{
				projectId: "mcp-project",
				hourTimestamp: hour,
				source: "unknown",
				requestCount: 12,
				cost: 2,
			},
		]);
		await db.insert(tables.apiKeyHourlyStats).values([
			{
				projectId: "mcp-project",
				apiKeyId: "mcp-member-key",
				hourTimestamp: hour,
				requestCount: 5,
				cost: 1,
				totalTokens: "100",
			},
			{
				projectId: "mcp-project",
				apiKeyId: "mcp-member-old-key",
				hourTimestamp: hour,
				requestCount: 2,
				cost: 0.5,
				totalTokens: "50",
			},
			{
				projectId: "mcp-project",
				apiKeyId: "mcp-owner-key",
				hourTimestamp: hour,
				requestCount: 23,
				cost: 2.5,
				totalTokens: "450",
			},
			{
				projectId: "mcp-sibling",
				apiKeyId: "mcp-member-key",
				hourTimestamp: new Date("2026-03-01T11:00:00Z"),
				requestCount: 999,
			},
		]);
		await db.insert(tables.apiKeyHourlyModelStats).values([
			{
				projectId: "mcp-project",
				apiKeyId: "mcp-member-key",
				hourTimestamp: hour,
				usedProvider: "provider-a",
				usedModel: "model-a",
				requestCount: 5,
				cost: 1,
			},
			{
				projectId: "mcp-project",
				apiKeyId: "mcp-owner-key",
				hourTimestamp: hour,
				usedProvider: "private-provider",
				usedModel: "private-model",
				requestCount: 23,
			},
		]);
		await db.insert(tables.apiKeyHourlySourceStats).values([
			{
				projectId: "mcp-project",
				apiKeyId: "mcp-member-key",
				hourTimestamp: hour,
				source: "codex",
				requestCount: 5,
				cost: 1,
			},
			{
				projectId: "mcp-project",
				apiKeyId: "mcp-owner-key",
				hourTimestamp: hour,
				source: "private-app",
				requestCount: 23,
			},
		]);
	});
	afterEach(deleteAll);

	function request(
		path: string,
		input?: Record<string, unknown>,
		token = "mcp-owner-token",
	) {
		return app.request(`/mcp/${path}`, {
			method: input ? "POST" : "GET",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: input ? JSON.stringify(input) : undefined,
		});
	}

	test("returns account scope and limits without credentials or personal contact details", async () => {
		const response = await request("account");
		expect(response.status).toBe(200);
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		const raw = await response.json();
		const account = mcpAccountSchema.parse(raw);
		expect(account.usageScope).toEqual({
			type: "project",
			projectId: "mcp-project",
			userId: null,
		});
		expect(account.creditsBalanceUsd).toBe(100);
		expect(JSON.stringify(raw)).not.toMatch(
			/tokenHash|tokenPrefix|billingEmail|owner@example/,
		);
		expect(JSON.stringify(raw)).not.toContain("mcp-owner-token");
	});

	test("reports totals and true rankings from retained aggregates with no request logs", async () => {
		const response = await request("usage", { ...period, granularity: "hour" });
		expect(response.status).toBe(200);
		const usage = mcpUsageSchema.parse(await response.json());
		expect(usage.totals).toMatchObject({
			requestCount: 30,
			costUsd: 4,
			creditsCostUsd: 3,
			byokCostUsd: 1,
			dataStorageCostUsd: 0.25,
			totalTokens: 600,
			errorCount: 2,
			cacheCount: 3,
		});
		expect(usage.series).toHaveLength(1);
		expect(usage.series[0].date).toBe("2026-03-01T10:00:00Z");
		expect(usage.mostUsedProvider).toMatchObject({
			id: "provider-a",
			requestCount: 16,
		});
		expect(usage.mostUsedModel).toMatchObject({
			id: "model-b",
			requestCount: 20,
		});
		expect(usage.mostUsedApp).toMatchObject({
			id: "opencode",
			name: "OpenCode",
			requestCount: 18,
		});
		expect(usage.appUsageCoverage.complete).toBe(true);
		expect(await db.query.log.findMany({ limit: 1 })).toEqual([]);
	});

	test.each(["provider", "model", "app", "api_key"])(
		"restricts developer %s usage to their keys in the connected project",
		async (group_by) => {
			const response = await request(
				"usage/breakdown",
				{ ...period, group_by },
				"mcp-member-token",
			);
			expect(response.status).toBe(200);
			const result = mcpUsageBreakdownSchema.parse(await response.json());
			expect(result.scope.type).toBe("member");
			expect(result.rows.reduce((sum, row) => sum + row.requestCount, 0)).toBe(
				group_by === "api_key" ? 7 : 5,
			);
			expect(JSON.stringify(result)).not.toMatch(
				/private-|mcp-owner-key|mcp-sibling/,
			);
		},
	);

	test("includes inactive-key history and flags missing personal app history", async () => {
		const account = mcpAccountSchema.parse(
			await (await request("account", undefined, "mcp-member-token")).json(),
		);
		expect(account.creditsBalanceUsd).toBeNull();
		const usage = mcpUsageSchema.parse(
			await (await request("usage", period, "mcp-member-token")).json(),
		);
		expect(usage.totals.requestCount).toBe(7);
		expect(usage.mostUsedApp?.id).toBe("codex");
		expect(usage.appUsageCoverage).toEqual({
			requestCount: 5,
			totalRequestCount: 7,
			complete: false,
		});
	});

	test("sorts and paginates without reducing coverage to the returned page", async () => {
		const result = mcpUsageBreakdownSchema.parse(
			await (
				await request("usage/breakdown", {
					...period,
					group_by: "provider",
					sort_by: "tokens",
					limit: 1,
				})
			).json(),
		);
		expect(result.rows[0].id).toBe("provider-b");
		expect(result.pagination.hasMore).toBe(true);
		expect(result.coverage).toEqual({
			requestCount: 30,
			totalRequestCount: 30,
			complete: true,
		});
		const next = mcpUsageBreakdownSchema.parse(
			await (
				await request("usage/breakdown", {
					...period,
					group_by: "provider",
					sort_by: "tokens",
					limit: 1,
					offset: 1,
				})
			).json(),
		);
		expect(next.rows[0].id).toBe("provider-a");
		expect(next.pagination.hasMore).toBe(false);
	});

	test("returns zero totals and null rankings for empty periods", async () => {
		const usage = mcpUsageSchema.parse(
			await (
				await request("usage", { from: "2025-01-01", to: "2025-01-01" })
			).json(),
		);
		expect(usage.totals.requestCount).toBe(0);
		expect(usage.totals.costUsd).toBe(0);
		expect(usage.series).toEqual([]);
		expect(usage.mostUsedProvider).toBeNull();
		expect(usage.mostUsedModel).toBeNull();
		expect(usage.mostUsedApp).toBeNull();
		expect(usage.updatedAt).toBeNull();
	});

	test.each([
		{ from: "2026-02-30" },
		{ from: "2026-03-03", to: "2026-03-01" },
		{ from: "2024-01-01", to: "2026-01-01" },
		{ ...period, projectId: "mcp-other-project" },
		{ from: "2026-01-01", to: "2026-03-01", granularity: "hour" },
	])(
		"rejects invalid dates, oversized ranges and scope overrides: %j",
		async (input) => {
			expect((await request("usage", input)).status).toBe(400);
		},
	);

	test("allows analytics at spending limits but rejects expired and inactive keys", async () => {
		await db
			.update(tables.apiKey)
			.set({ usage: "10", usageLimit: "10" })
			.where(eq(tables.apiKey.id, "mcp-owner-key"));
		expect((await request("usage", period)).status).toBe(200);
		await db
			.update(tables.apiKey)
			.set({ expiresAt: new Date("2020-01-01") })
			.where(eq(tables.apiKey.id, "mcp-owner-key"));
		expect((await request("account")).status).toBe(401);
		expect((await request("account", undefined, "mcp-old-token")).status).toBe(
			401,
		);
		expect((await request("account", undefined, "invalid-token")).status).toBe(
			401,
		);
		expect((await app.request("/mcp/account")).status).toBe(401);
	});

	test("rejects a revoked project grant and deleted organization", async () => {
		await db.delete(tables.userProject);
		expect((await request("usage", period, "mcp-member-token")).status).toBe(
			403,
		);
		await db
			.update(tables.organization)
			.set({ status: "deleted" })
			.where(eq(tables.organization.id, "mcp-org"));
		expect((await request("account")).status).toBe(403);
	});

	test("rejects customer credentials instead of borrowing the creator's permissions", async () => {
		await db
			.update(tables.apiKey)
			.set({ keyType: "end_user_customer" })
			.where(eq(tables.apiKey.id, "mcp-owner-key"));
		expect((await request("account")).status).toBe(401);
	});
});
