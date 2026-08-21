import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";
import { MAX_BULK_BLOCK_ORGANIZATIONS } from "@llmgateway/shared";

const originalAdminEmails = process.env.ADMIN_EMAILS;

interface PreviewResponse {
	search: string;
	matched: number;
	blockable: number;
	skipped: number;
	maxBulkSize: number;
	organizations: { id: string; name: string }[];
}

interface BulkBlockResponse {
	message: string;
	blockedCount: number;
	failedCount: number;
	blocked: { id: string; name: string }[];
	failed: { id: string; name: string; error: string }[];
}

async function insertOrg(
	id: string,
	name: string,
	overrides: Partial<typeof tables.organization.$inferInsert> = {},
) {
	await db.insert(tables.organization).values({
		id,
		name,
		billingEmail: `${id}@fraudring.test`,
		...overrides,
	});
}

async function preview(search: string, token?: string): Promise<Response> {
	return await app.request(
		`/admin/organizations/bulk-block/preview?search=${encodeURIComponent(search)}`,
		{
			headers: token ? { Cookie: token } : {},
		},
	);
}

async function bulkBlock(body: unknown, token?: string): Promise<Response> {
	return await app.request("/admin/organizations/bulk-block", {
		method: "POST",
		headers: {
			...(token ? { Cookie: token } : {}),
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});
}

async function getStatus(orgId: string) {
	const org = await db.query.organization.findFirst({
		where: { id: { eq: orgId } },
	});
	return org?.status ?? null;
}

describe("admin bulk block organizations", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();
	});

	afterEach(async () => {
		if (originalAdminEmails === undefined) {
			delete process.env.ADMIN_EMAILS;
		} else {
			process.env.ADMIN_EMAILS = originalAdminEmails;
		}
		await deleteAll();
	});

	it("rejects unauthenticated and non-admin requests", async () => {
		expect((await preview("fraud")).status).toBe(401);
		expect(
			(await bulkBlock({ search: "fraud", expectedCount: 1 })).status,
		).toBe(401);

		process.env.ADMIN_EMAILS = "someone-else@example.com";
		expect((await preview("fraud", cookie)).status).toBe(403);
		expect(
			(await bulkBlock({ search: "fraud", expectedCount: 1 }, cookie)).status,
		).toBe(403);
	});

	it("rejects an empty or too short search filter", async () => {
		await insertOrg("bulk-a", "Fraud Ring Alpha");

		for (const search of ["", " ", "fr", "  a  "]) {
			expect((await preview(search, cookie)).status).toBe(400);
			expect(
				(await bulkBlock({ search, expectedCount: 1 }, cookie)).status,
			).toBe(400);
		}

		expect(await getStatus("bulk-a")).toBe("active");
	});

	it("rejects a zero or negative expected count", async () => {
		await insertOrg("bulk-a", "Fraud Ring Alpha");

		for (const expectedCount of [0, -1]) {
			const res = await bulkBlock({ search: "fraud", expectedCount }, cookie);
			expect(res.status).toBe(400);
		}

		expect(await getStatus("bulk-a")).toBe("active");
	});

	it("escapes LIKE wildcards so a wildcard search matches nothing", async () => {
		await insertOrg("bulk-a", "Fraud Ring Alpha");
		await insertOrg("bulk-b", "Legit Corp");

		const res = await preview("%%%", cookie);
		expect(res.status).toBe(200);
		const json = (await res.json()) as PreviewResponse;
		expect(json.matched).toBe(0);
		expect(json.blockable).toBe(0);

		const blockRes = await bulkBlock(
			{ search: "%%%", expectedCount: 2 },
			cookie,
		);
		expect(blockRes.status).toBe(409);
		expect(await getStatus("bulk-a")).toBe("active");
		expect(await getStatus("bulk-b")).toBe("active");
	});

	it("previews only the organizations the filter can block", async () => {
		await insertOrg("bulk-a", "Fraud Ring Alpha");
		await insertOrg("bulk-b", "Fraud Ring Beta");
		await insertOrg("bulk-deleted", "Fraud Ring Gone", { status: "deleted" });
		await insertOrg("bulk-own", "Fraud Ring Own");
		await insertOrg("bulk-other", "Legit Corp");
		await db.insert(tables.userOrganization).values({
			userId: "test-user-id",
			organizationId: "bulk-own",
			role: "owner",
		});

		const res = await preview("fraud ring", cookie);
		expect(res.status).toBe(200);
		const json = (await res.json()) as PreviewResponse;

		expect(json.matched).toBe(4);
		expect(json.blockable).toBe(2);
		expect(json.skipped).toBe(2);
		expect(json.organizations.map((o) => o.id).sort()).toEqual([
			"bulk-a",
			"bulk-b",
		]);
	});

	it("excludes organizations that still have credits", async () => {
		await insertOrg("bulk-a", "Fraud Ring Alpha");
		await insertOrg("bulk-paying", "Fraud Ring Paying", { credits: "42.00" });
		await insertOrg("bulk-negative", "Fraud Ring Negative", {
			credits: "-3.00",
		});

		const res = await preview("fraud ring", cookie);
		expect(res.status).toBe(200);
		const json = (await res.json()) as PreviewResponse;

		expect(json.matched).toBe(3);
		expect(json.blockable).toBe(2);
		expect(json.skipped).toBe(1);
		expect(json.organizations.map((o) => o.id).sort()).toEqual([
			"bulk-a",
			"bulk-negative",
		]);
	});

	it("never blocks an organization that still has credits", async () => {
		await insertOrg("bulk-a", "Fraud Ring Alpha");
		await insertOrg("bulk-paying", "Fraud Ring Paying", { credits: "0.01" });

		const res = await bulkBlock(
			{ search: "fraud ring", expectedCount: 1 },
			cookie,
		);
		expect(res.status).toBe(200);
		const json = (await res.json()) as BulkBlockResponse;
		expect(json.blockedCount).toBe(1);
		expect(json.blocked.map((o) => o.id)).toEqual(["bulk-a"]);

		expect(await getStatus("bulk-a")).toBe("deleted");
		expect(await getStatus("bulk-paying")).toBe("active");
	});

	it("blocks exactly the filtered organizations and nothing else", async () => {
		await insertOrg("bulk-a", "Fraud Ring Alpha");
		await insertOrg("bulk-b", "Fraud Ring Beta");
		await insertOrg("bulk-other", "Legit Corp");

		const res = await bulkBlock(
			{ search: "fraud ring", expectedCount: 2 },
			cookie,
		);
		expect(res.status).toBe(200);
		const json = (await res.json()) as BulkBlockResponse;
		expect(json.blockedCount).toBe(2);
		expect(json.failedCount).toBe(0);

		expect(await getStatus("bulk-a")).toBe("deleted");
		expect(await getStatus("bulk-b")).toBe("deleted");
		expect(await getStatus("bulk-other")).toBe("active");
	});

	it("blocks nothing when the confirmed count does not match", async () => {
		await insertOrg("bulk-a", "Fraud Ring Alpha");
		await insertOrg("bulk-b", "Fraud Ring Beta");

		const res = await bulkBlock(
			{ search: "fraud ring", expectedCount: 1 },
			cookie,
		);
		expect(res.status).toBe(409);

		expect(await getStatus("bulk-a")).toBe("active");
		expect(await getStatus("bulk-b")).toBe("active");
	});

	it("never touches the acting admin's own organizations", async () => {
		await insertOrg("bulk-a", "Fraud Ring Alpha");
		await insertOrg("bulk-own", "Fraud Ring Own");
		await db.insert(tables.userOrganization).values({
			userId: "test-user-id",
			organizationId: "bulk-own",
			role: "owner",
		});

		const res = await bulkBlock(
			{ search: "fraud ring", expectedCount: 1 },
			cookie,
		);
		expect(res.status).toBe(200);

		expect(await getStatus("bulk-a")).toBe("deleted");
		expect(await getStatus("bulk-own")).toBe("active");
	});

	it("deactivates members of blocked organizations", async () => {
		await insertOrg("bulk-a", "Fraud Ring Alpha");
		await db.insert(tables.user).values({
			id: "bulk-member",
			name: "Bulk Member",
			email: "member@fraudring.test",
			emailVerified: true,
		});
		await db.insert(tables.userOrganization).values({
			userId: "bulk-member",
			organizationId: "bulk-a",
			role: "owner",
		});

		const res = await bulkBlock({ search: "fraud", expectedCount: 1 }, cookie);
		expect(res.status).toBe(200);

		const member = await db.query.user.findFirst({
			where: { id: { eq: "bulk-member" } },
		});
		expect(member?.status).toBe("deactivated");
	});

	it("refuses filters that match more than the bulk cap", async () => {
		await db.insert(tables.organization).values(
			Array.from({ length: MAX_BULK_BLOCK_ORGANIZATIONS + 1 }, (_, index) => ({
				id: `bulkcap-${index}`,
				name: `Bulkcap Org ${index}`,
				billingEmail: `bulkcap-${index}@fraudring.test`,
			})),
		);

		const previewRes = await preview("bulkcap", cookie);
		expect(previewRes.status).toBe(400);

		const blockRes = await bulkBlock(
			{ search: "bulkcap", expectedCount: MAX_BULK_BLOCK_ORGANIZATIONS },
			cookie,
		);
		expect(blockRes.status).toBe(400);

		expect(await getStatus("bulkcap-0")).toBe("active");
	});
});
