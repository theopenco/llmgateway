import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import {
	apiKeyHourlyStats,
	db,
	eq,
	projectHourlyStats,
	tables,
} from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

function hoursAgo(hours: number) {
	const date = new Date();
	date.setUTCMinutes(0, 0, 0);
	date.setUTCHours(date.getUTCHours() - hours);
	return date;
}

describe("GET /orgs/{id}/projects/usage", () => {
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
			role: "owner",
		});
		await db.insert(tables.project).values([
			{ id: "busy-project", name: "Busy", organizationId: "test-org-id" },
			{ id: "idle-project", name: "Idle", organizationId: "test-org-id" },
			{
				id: "deleted-project",
				name: "Deleted",
				organizationId: "test-org-id",
				status: "deleted",
			},
		]);
		await db.insert(tables.user).values({
			id: "teammate-id",
			name: "Teammate",
			email: "teammate@example.com",
			emailVerified: true,
		});
		await db.insert(tables.apiKey).values([
			{
				id: "own-key",
				...hashApiKeyForStorage("own-token"),
				projectId: "busy-project",
				description: "Own",
				createdBy: "test-user-id",
			},
			{
				id: "teammate-key",
				...hashApiKeyForStorage("teammate-token"),
				projectId: "busy-project",
				description: "Teammate",
				createdBy: "teammate-id",
			},
			{
				id: "deleted-key",
				...hashApiKeyForStorage("deleted-token"),
				projectId: "busy-project",
				description: "Deleted",
				createdBy: "test-user-id",
				status: "deleted",
			},
		]);

		await db.insert(projectHourlyStats).values([
			{
				projectId: "busy-project",
				hourTimestamp: hoursAgo(1),
				requestCount: 5,
				errorCount: 1,
				totalTokens: "500",
				cost: 1.5,
			},
			{
				projectId: "busy-project",
				hourTimestamp: hoursAgo(72),
				requestCount: 3,
				totalTokens: "300",
				cost: 0.5,
			},
			{
				projectId: "idle-project",
				hourTimestamp: hoursAgo(24 * 60),
				requestCount: 2,
				totalTokens: "100",
				cost: 0.25,
			},
		]);
		await db.insert(apiKeyHourlyStats).values([
			{
				apiKeyId: "own-key",
				projectId: "busy-project",
				hourTimestamp: hoursAgo(1),
				requestCount: 2,
				totalTokens: "200",
				cost: 0.5,
			},
			{
				apiKeyId: "teammate-key",
				projectId: "busy-project",
				hourTimestamp: hoursAgo(1),
				requestCount: 3,
				totalTokens: "300",
				cost: 1,
			},
		]);
	});

	afterEach(async () => {
		await deleteAll();
	});

	async function usage(query = "") {
		return await app.request(`/orgs/test-org-id/projects/usage${query}`, {
			headers: { Cookie: token },
		});
	}

	test("returns totals, a zero-filled daily trend and last activity per project", async () => {
		const res = await usage("?days=7");
		expect(res.status).toBe(200);
		const body = await res.json();

		expect(body.days).toBe(7);
		const ids = body.projects.map((p: { projectId: string }) => p.projectId);
		expect(ids.sort()).toEqual(["busy-project", "idle-project"]);

		const busy = body.projects.find(
			(p: { projectId: string }) => p.projectId === "busy-project",
		);
		expect(busy).toMatchObject({
			requestCount: 8,
			errorCount: 1,
			totalTokens: 800,
			apiKeyCount: 2,
			lastActiveAt: hoursAgo(1).toISOString(),
		});
		expect(busy.cost).toBeCloseTo(2);
		expect(busy.daily.length).toBeGreaterThanOrEqual(7);
		expect(
			busy.daily.reduce(
				(sum: number, day: { requestCount: number }) => sum + day.requestCount,
				0,
			),
		).toBe(8);

		const idle = body.projects.find(
			(p: { projectId: string }) => p.projectId === "idle-project",
		);
		expect(idle).toMatchObject({
			requestCount: 0,
			cost: 0,
			apiKeyCount: 0,
			lastActiveAt: hoursAgo(24 * 60).toISOString(),
		});
	});

	test("limits a developer to their own keys in granted projects", async () => {
		await db
			.update(tables.userOrganization)
			.set({ role: "developer" })
			.where(eq(tables.userOrganization.id, "test-user-org-id"));
		await db.insert(tables.userProject).values({
			id: "test-user-project-id",
			userOrganizationId: "test-user-org-id",
			projectId: "busy-project",
		});

		const res = await usage();
		expect(res.status).toBe(200);
		const body = await res.json();

		expect(body.projects).toHaveLength(1);
		expect(body.projects[0]).toMatchObject({
			projectId: "busy-project",
			requestCount: 2,
			totalTokens: 200,
			apiKeyCount: 1,
		});
		expect(body.projects[0].cost).toBeCloseTo(0.5);
	});

	test("scopes usage to an explicit from/to window", async () => {
		const day = hoursAgo(72).toISOString().slice(0, 10);
		const res = await usage(`?from=${day}&to=${day}&timezone=UTC`);
		expect(res.status).toBe(200);
		const body = await res.json();

		expect(body).toMatchObject({ days: 1, from: day, to: day });
		const busy = body.projects.find(
			(p: { projectId: string }) => p.projectId === "busy-project",
		);
		expect(busy).toMatchObject({
			requestCount: 3,
			lastActiveAt: hoursAgo(1).toISOString(),
			daily: [{ date: day, requestCount: 3 }],
		});
	});

	test("folds long ranges into a bounded trend", async () => {
		const today = new Date().toISOString().slice(0, 10);
		const res = await usage(`?from=2020-01-01&to=${today}&timezone=UTC`);
		expect(res.status).toBe(200);
		const body = await res.json();

		expect(body.days).toBeGreaterThan(2000);
		for (const project of body.projects) {
			expect(project.daily.length).toBeLessThanOrEqual(90);
			expect(project.daily[0].date).toBe("2020-01-01");
			expect(
				project.daily.reduce(
					(sum: number, day: { requestCount: number }) =>
						sum + day.requestCount,
					0,
				),
			).toBe(project.requestCount);
		}
		const totals = Object.fromEntries(
			body.projects.map((p: { projectId: string; requestCount: number }) => [
				p.projectId,
				p.requestCount,
			]),
		);
		expect(totals).toEqual({ "busy-project": 8, "idle-project": 2 });
	});

	test("rejects incomplete or inverted ranges", async () => {
		expect((await usage("?from=2024-01-01")).status).toBe(400);
		expect((await usage("?from=2024-02-01&to=2024-01-01")).status).toBe(400);
		expect((await usage("?from=yesterday&to=today")).status).toBe(400);
		expect((await usage("?from=0001-01-01&to=2024-01-01")).status).toBe(400);
		expect((await usage("?from=2026-02-30&to=2026-02-30")).status).toBe(400);
	});

	test("rejects organizations the user does not belong to", async () => {
		await db.insert(tables.organization).values({
			id: "other-org-id",
			name: "Other",
			billingEmail: "other@example.com",
		});
		const res = await app.request("/orgs/other-org-id/projects/usage", {
			headers: { Cookie: token },
		});
		expect(res.status).toBe(403);
	});
});

describe("POST /orgs/{id}/projects/bulk", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();
		await db.insert(tables.organization).values([
			{
				id: "test-org-id",
				name: "Test Organization",
				billingEmail: "test@example.com",
			},
			{
				id: "other-org-id",
				name: "Other Organization",
				billingEmail: "other@example.com",
			},
		]);
		await db.insert(tables.userOrganization).values({
			id: "test-user-org-id",
			userId: "test-user-id",
			organizationId: "test-org-id",
			role: "owner",
		});
		await db.insert(tables.project).values([
			{ id: "project-a", name: "A", organizationId: "test-org-id" },
			{
				id: "project-b",
				name: "B",
				organizationId: "test-org-id",
				mode: "credits",
			},
			{ id: "foreign-project", name: "F", organizationId: "other-org-id" },
		]);
	});

	afterEach(async () => {
		await deleteAll();
	});

	async function bulk(body: unknown) {
		return await app.request("/orgs/test-org-id/projects/bulk", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: token },
			body: JSON.stringify(body),
		});
	}

	test("updates settings, skips unchanged projects and ignores other orgs", async () => {
		const res = await bulk({
			action: "update",
			ids: ["project-a", "project-b", "foreign-project"],
			settings: { mode: "credits" },
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.succeeded).toEqual(["project-a"]);
		expect(body.skipped).toEqual(["project-b"]);
		expect(body.failed).toEqual([
			expect.objectContaining({ id: "foreign-project", reason: "not_found" }),
		]);

		const projectA = await db.query.project.findFirst({
			where: { id: { eq: "project-a" } },
		});
		const foreign = await db.query.project.findFirst({
			where: { id: { eq: "foreign-project" } },
		});
		expect(projectA?.mode).toBe("credits");
		expect(foreign?.mode).toBe("hybrid");

		const audit = await db.query.auditLog.findMany({
			where: { action: { eq: "project.update" } },
		});
		expect(audit.map((entry) => entry.resourceId)).toEqual(["project-a"]);
	});

	test("rejects an update without settings", async () => {
		const res = await bulk({ action: "update", ids: ["project-a"] });
		expect(res.status).toBe(400);
	});

	test("archives projects for owners only", async () => {
		const res = await bulk({
			action: "delete",
			ids: ["project-a", "project-b"],
		});
		expect(res.status).toBe(200);
		expect((await res.json()).succeeded).toEqual(["project-a", "project-b"]);
		const archived = await db.query.project.findMany({
			where: { organizationId: { eq: "test-org-id" } },
		});
		expect(archived.every((project) => project.status === "deleted")).toBe(
			true,
		);
	});

	test("refuses to archive as an admin", async () => {
		await db
			.update(tables.userOrganization)
			.set({ role: "admin" })
			.where(eq(tables.userOrganization.id, "test-user-org-id"));

		const res = await bulk({ action: "delete", ids: ["project-a"] });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.succeeded).toEqual([]);
		expect(body.failed[0].reason).toBe("owner_only");
		const project = await db.query.project.findFirst({
			where: { id: { eq: "project-a" } },
		});
		expect(project?.status).not.toBe("deleted");
	});

	test("refuses caching while zero data retention is on", async () => {
		await db
			.update(tables.organization)
			.set({
				providerCompliancePolicy: { enabled: true, zeroDataRetention: true },
			})
			.where(eq(tables.organization.id, "test-org-id"));

		const res = await bulk({
			action: "update",
			ids: ["project-a"],
			settings: { cachingEnabled: true },
		});
		const body = await res.json();
		expect(body.failed[0].reason).toBe("zdr_caching");
	});
});
