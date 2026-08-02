import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

const originalAdminEmails = process.env.ADMIN_EMAILS;

async function insertOrg(id: string, credits: string) {
	await db.insert(tables.organization).values({
		id,
		name: `Credit Org ${id}`,
		billingEmail: `${id}@credits.test`,
		credits,
	});
}

async function block(orgId: string, token: string): Promise<Response> {
	return await app.request(`/admin/organizations/${orgId}/block`, {
		method: "POST",
		headers: { Cookie: token },
	});
}

async function setStatus(
	orgId: string,
	status: "active" | "deleted",
	token: string,
): Promise<Response> {
	return await app.request(`/admin/organizations/${orgId}/status`, {
		method: "PATCH",
		headers: { Cookie: token, "Content-Type": "application/json" },
		body: JSON.stringify({ status }),
	});
}

async function getStatus(orgId: string) {
	const org = await db.query.organization.findFirst({
		where: { id: { eq: orgId } },
	});
	return org?.status ?? null;
}

describe("admin organization deletion credit guard", () => {
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

	it("refuses to block an organization with positive credits", async () => {
		await insertOrg("credit-positive", "12.34");

		const res = await block("credit-positive", cookie);
		expect(res.status).toBe(409);
		const json = (await res.json()) as { message: string };
		expect(json.message).toContain("positive credit balance");

		expect(await getStatus("credit-positive")).toBe("active");
	});

	it("refuses to disable an organization with positive credits", async () => {
		await insertOrg("credit-positive", "0.01");

		const res = await setStatus("credit-positive", "deleted", cookie);
		expect(res.status).toBe(409);

		expect(await getStatus("credit-positive")).toBe("active");
	});

	it.each([
		["zero credits", "0"],
		["negative credits", "-5.00"],
	])("blocks an organization with %s", async (_label, credits) => {
		await insertOrg("credit-empty", credits);

		const res = await block("credit-empty", cookie);
		expect(res.status).toBe(200);

		expect(await getStatus("credit-empty")).toBe("deleted");
	});

	it.each([
		["zero credits", "0"],
		["negative credits", "-1.50"],
	])("disables an organization with %s", async (_label, credits) => {
		await insertOrg("credit-empty", credits);

		const res = await setStatus("credit-empty", "deleted", cookie);
		expect(res.status).toBe(200);

		expect(await getStatus("credit-empty")).toBe("deleted");
	});

	it("still re-enables an organization that has credits", async () => {
		await insertOrg("credit-restore", "0");
		expect((await setStatus("credit-restore", "deleted", cookie)).status).toBe(
			200,
		);

		// A gifted refund after the block must not trap the organization in the
		// deleted state: only the destructive direction is credit-gated.
		await db
			.update(tables.organization)
			.set({ credits: "25.00" })
			.where(eq(tables.organization.id, "credit-restore"));

		const res = await setStatus("credit-restore", "active", cookie);
		expect(res.status).toBe(200);

		expect(await getStatus("credit-restore")).toBe("active");
	});

	it("does not deactivate members when the block is refused", async () => {
		await insertOrg("credit-positive", "10.00");
		await db.insert(tables.user).values({
			id: "credit-member",
			name: "Credit Member",
			email: "member@credits.test",
			emailVerified: true,
		});
		await db.insert(tables.userOrganization).values({
			userId: "credit-member",
			organizationId: "credit-positive",
			role: "owner",
		});

		expect((await block("credit-positive", cookie)).status).toBe(409);

		const member = await db.query.user.findFirst({
			where: { id: { eq: "credit-member" } },
		});
		expect(member?.status).toBe("active");
	});
});
