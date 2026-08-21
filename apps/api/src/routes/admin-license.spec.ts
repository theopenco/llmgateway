import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

const originalAdminEmails = process.env.ADMIN_EMAILS;
const originalNodeEnv = process.env.NODE_ENV;

describe("admin Enterprise license", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();
	});

	afterEach(async () => {
		process.env.NODE_ENV = originalNodeEnv;
		if (originalAdminEmails === undefined) {
			delete process.env.ADMIN_EMAILS;
		} else {
			process.env.ADMIN_EMAILS = originalAdminEmails;
		}
		await deleteAll();
	});

	it("returns development status and distinct licensed seats", async () => {
		await db.insert(tables.organization).values([
			{
				id: "enterprise-a",
				name: "Enterprise A",
				billingEmail: "a@example.com",
				plan: "enterprise",
			},
			{
				id: "enterprise-b",
				name: "Enterprise B",
				billingEmail: "b@example.com",
				plan: "enterprise",
			},
		]);
		await db.insert(tables.userOrganization).values([
			{
				userId: "test-user-id",
				organizationId: "enterprise-a",
				role: "owner",
			},
			{
				userId: "test-user-id",
				organizationId: "enterprise-b",
				role: "admin",
			},
		]);

		const response = await app.request("/admin/license", {
			headers: { Cookie: cookie },
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			status: "development",
			enterpriseEnabled: true,
			maxSeats: null,
			seatsUsed: 1,
			seatsRemaining: null,
		});
	});

	it("requires an admin session", async () => {
		process.env.ADMIN_EMAILS = "someone-else@example.com";
		const response = await app.request("/admin/license", {
			headers: { Cookie: cookie },
		});
		expect(response.status).toBe(403);
	});

	it("keeps license status available while production admin APIs are locked", async () => {
		process.env.NODE_ENV = "production";
		const statusResponse = await app.request("/admin/license", {
			headers: { Cookie: cookie },
		});
		expect(statusResponse.status).toBe(200);
		expect(await statusResponse.json()).toMatchObject({
			status: "missing",
			enterpriseEnabled: false,
		});

		const adminResponse = await app.request("/admin/organizations", {
			headers: { Cookie: cookie },
		});
		expect(adminResponse.status).toBe(403);
	});
});
