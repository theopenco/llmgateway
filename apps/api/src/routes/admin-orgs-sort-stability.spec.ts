import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

// Enough rows that Postgres picks a different top-N sort per LIMIT/OFFSET, which
// is what makes an untied ORDER BY hand back overlapping pages.
const ORG_COUNT = 3000;
const PAGE_SIZE = 25;

interface OrgListResponse {
	organizations: { id: string }[];
	total: number;
}

async function collectPages(cookie: string, sortBy: string, pages: number) {
	const ids: string[] = [];
	for (let page = 0; page < pages; page++) {
		const res = await app.request(
			`/admin/organizations?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}&sortBy=${sortBy}&sortOrder=asc`,
			{ headers: { Cookie: cookie } },
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as OrgListResponse;
		ids.push(...body.organizations.map((o) => o.id));
	}
	return ids;
}

describe("admin — organizations list sort stability", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();

		// No usage rows, so every org ties at 0 requests and 0 tokens.
		await db.insert(tables.organization).values(
			Array.from({ length: ORG_COUNT }, (_, i) => ({
				id: `sort-stability-org-${String(i).padStart(4, "0")}`,
				name: `Sort Stability Org ${i}`,
				billingEmail: `sort-stability-${i}@example.com`,
			})),
		);
	});

	afterEach(async () => {
		await deleteAll();
	});

	test.each(["totalTokens", "totalRequests"])(
		"pages through tied %s totals without repeating or dropping rows",
		async (sortBy) => {
			const ids = await collectPages(cookie, sortBy, 3);
			expect(ids).toHaveLength(3 * PAGE_SIZE);
			expect(new Set(ids).size).toBe(ids.length);
		},
	);

	test("returns the same page twice for a tied sort", async () => {
		const first = await collectPages(cookie, "totalTokens", 2);
		const second = await collectPages(cookie, "totalTokens", 2);
		expect(second).toEqual(first);
	});
});
