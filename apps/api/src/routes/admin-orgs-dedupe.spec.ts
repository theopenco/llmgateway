import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

const MULTI_OWNER_ORG_ID = "dedupe-multi-owner-org";
const FIRST_OWNER_ID = "dedupe-owner-first";
const SECOND_OWNER_ID = "dedupe-owner-second";
const FIRST_OWNER_EMAIL = "dedupe-owner-first@example.com";
const SECOND_OWNER_EMAIL = "dedupe-owner-second@example.com";

interface OrgListResponse {
	organizations: {
		id: string;
		ownerUserId: string | null;
		ownerEmail: string | null;
	}[];
	total: number;
}

describe("admin — organizations list deduplication", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();

		await db.insert(tables.organization).values({
			id: MULTI_OWNER_ORG_ID,
			name: "Dedupe Multi Owner Org",
			billingEmail: "dedupe-multi-owner@example.com",
		});

		await db.insert(tables.user).values([
			{
				id: FIRST_OWNER_ID,
				name: "First Owner",
				email: FIRST_OWNER_EMAIL,
				emailVerified: true,
			},
			{
				id: SECOND_OWNER_ID,
				name: "Second Owner",
				email: SECOND_OWNER_EMAIL,
				emailVerified: true,
			},
		]);

		await db.insert(tables.userOrganization).values([
			{
				id: "dedupe-membership-first",
				userId: FIRST_OWNER_ID,
				organizationId: MULTI_OWNER_ORG_ID,
				role: "owner",
				createdAt: new Date("2026-01-01T00:00:00.000Z"),
			},
			{
				id: "dedupe-membership-second",
				userId: SECOND_OWNER_ID,
				organizationId: MULTI_OWNER_ORG_ID,
				role: "owner",
				createdAt: new Date("2026-02-01T00:00:00.000Z"),
			},
		]);
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("lists an org with several owners once, keyed to the first owner", async () => {
		const res = await app.request("/admin/organizations?limit=50", {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as OrgListResponse;

		const rows = body.organizations.filter((o) => o.id === MULTI_OWNER_ORG_ID);
		expect(rows).toHaveLength(1);
		expect(rows[0].ownerUserId).toBe(FIRST_OWNER_ID);
		expect(rows[0].ownerEmail).toBe(FIRST_OWNER_EMAIL);
		expect(body.organizations).toHaveLength(body.total);
	});

	test("lists it once when searching by any owner's email", async () => {
		for (const email of [FIRST_OWNER_EMAIL, SECOND_OWNER_EMAIL]) {
			const res = await app.request(
				`/admin/organizations?limit=50&search=${encodeURIComponent(email)}`,
				{ headers: { Cookie: cookie } },
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as OrgListResponse;

			expect(body.organizations).toHaveLength(1);
			expect(body.total).toBe(1);
			expect(body.organizations[0].id).toBe(MULTI_OWNER_ORG_ID);
		}
	});
});
