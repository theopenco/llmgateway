import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

const ORG_ID = "admin-devpass-search-org";
const originalAdminEmails = process.env.ADMIN_EMAILS;

interface ListResponse {
	subscribers: {
		id: string;
		ownerEmail: string | null;
		ownerUsername: string | null;
	}[];
	total: number;
}

async function insertOrg() {
	await db.insert(tables.organization).values({
		id: ORG_ID,
		name: "Personal Org",
		billingEmail: "admin@example.com",
		kind: "devpass",
		devPlan: "pro",
		devPlanCreditsUsed: "20",
		devPlanCreditsLimit: "237",
	});
	await db.insert(tables.userOrganization).values({
		userId: "test-user-id",
		organizationId: ORG_ID,
		role: "owner",
	});
}

async function listSubscribers(
	cookie: string,
	search: string,
): Promise<ListResponse> {
	const res = await app.request(
		`/admin/devpass?search=${encodeURIComponent(search)}`,
		{ headers: { Cookie: cookie } },
	);
	expect(res.status).toBe(200);
	return (await res.json()) as ListResponse;
}

describe("admin devpass search", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();
		await db
			.update(tables.user)
			.set({ username: "CodeWizard" })
			.where(eq(tables.user.id, "test-user-id"));
		await insertOrg();
	});

	afterEach(async () => {
		if (originalAdminEmails === undefined) {
			delete process.env.ADMIN_EMAILS;
		} else {
			process.env.ADMIN_EMAILS = originalAdminEmails;
		}
		await db.delete(tables.transaction);
		await deleteAll();
	});

	it("finds a subscriber by their DevPass profile username", async () => {
		const body = await listSubscribers(cookie, "codewiz");
		expect(body.total).toBe(1);
		expect(body.subscribers[0].id).toBe(ORG_ID);
		expect(body.subscribers[0].ownerUsername).toBe("CodeWizard");
	});

	it("returns nothing when no owner username or org field matches", async () => {
		const body = await listSubscribers(cookie, "someoneelse");
		expect(body.total).toBe(0);
		expect(body.subscribers).toHaveLength(0);
	});
});
