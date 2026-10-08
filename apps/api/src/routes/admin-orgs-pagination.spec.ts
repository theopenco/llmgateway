import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

interface OrganizationList {
	organizations: {
		id: string;
		totalSpent: string;
		totalCreditsAllTime: string;
		totalRequests: number;
		totalTokens: number;
	}[];
	total: number;
	totalCredits: string;
}

describe("admin organizations pagination before enrichment", () => {
	let cookie: string;

	async function list(query: Record<string, string> = {}) {
		const params = new URLSearchParams({ search: "pagination-org", ...query });
		const response = await app.request(`/admin/organizations?${params}`, {
			headers: { Cookie: cookie },
		});
		expect(response.status).toBe(200);
		return (await response.json()) as OrganizationList;
	}

	beforeEach(async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "admin@example.com";
		cookie = await createTestUser();
		await db.insert(tables.organization).values(
			[0, 1, 2, 3].map((i) => ({
				id: `pagination-org-${i}`,
				name: `Pagination ${i}`,
				billingEmail: `pagination-${i}@example.com`,
				credits: String(i + 1),
			})),
		);
		await db.insert(tables.project).values(
			[0, 1, 2].map((i) => ({
				id: `pagination-project-${i}`,
				organizationId: `pagination-org-${i}`,
				name: "Pagination project",
			})),
		);
		await db.insert(tables.projectHourlyStats).values(
			[0, 1, 2].map((i) => ({
				projectId: `pagination-project-${i}`,
				hourTimestamp: new Date("2026-01-01T12:00:00Z"),
				cost: i + 1,
				creditsCost: i + 1,
				requestCount: 3 - i,
				totalTokens: String((i + 1) * 100),
			})),
		);
		await db.insert(tables.transaction).values(
			[0, 1, 2].map((i) => ({
				organizationId: `pagination-org-${i}`,
				type: "credit_topup" as const,
				status: "completed" as const,
				creditAmount: String(3 - i),
			})),
		);
	});

	afterEach(async () => {
		await deleteAll();
	});

	test.each([
		"name",
		"createdAt",
		"totalSpent",
		"totalRequests",
		"totalTokens",
		"totalCreditsAllTime",
	])(
		"keeps %s order, enrichment and full-set totals across pages",
		async (sortBy) => {
			for (const sortOrder of ["asc", "desc"]) {
				const query = { sortBy, sortOrder };
				const full = await list(query);
				const first = await list({ ...query, limit: "2" });
				const second = await list({ ...query, limit: "2", offset: "2" });
				expect([...first.organizations, ...second.organizations]).toEqual(
					full.organizations,
				);
				expect(first.total).toBe(4);
				expect(second.total).toBe(4);
				expect(Number(second.totalCredits)).toBe(10);
				const empty = await list({ ...query, offset: "4" });
				expect(empty.organizations).toEqual([]);
				expect(empty.total).toBe(4);
				expect(Number(empty.totalCredits)).toBe(10);
			}
		},
	);

	test("filters the full set before paging and retains zero-usage organizations", async () => {
		const filtered = await list({
			minSpent: "2",
			limit: "1",
			sortBy: "totalCreditsAllTime",
			sortOrder: "desc",
		});
		expect(filtered.total).toBe(2);
		expect(Number(filtered.totalCredits)).toBe(5);
		expect(filtered.organizations[0]).toMatchObject({
			id: "pagination-org-1",
			totalRequests: 2,
			totalTokens: 200,
		});
		const windowed = await list({
			from: "2026-02-01",
			to: "2026-02-02",
			sortBy: "name",
			sortOrder: "asc",
			limit: "1",
		});
		expect(windowed.total).toBe(4);
		expect(windowed.organizations[0].totalRequests).toBe(0);
		expect(Number(windowed.organizations[0].totalSpent)).toBe(0);
		expect(Number(windowed.organizations[0].totalCreditsAllTime)).toBe(3);
		expect(
			(await list({ minSpent: "2", from: "2026-02-01", to: "2026-02-02" }))
				.total,
		).toBe(0);
	});
});
