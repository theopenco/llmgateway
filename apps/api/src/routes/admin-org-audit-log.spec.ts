import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

const ORG_ID = "audit-org";

describe("admin organization actions are audit logged", () => {
	let cookie: string;

	beforeEach(async () => {
		vi.stubEnv("ADMIN_FULL_ACCESS_EMAILS", "admin@example.com");
		cookie = await createTestUser();
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Audit Org",
			billingEmail: "audit@example.com",
		});
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
		await deleteAll();
	});

	function request(path: string, method: string, body?: unknown) {
		return app.request(path, {
			method,
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	}

	async function auditActions() {
		const rows = await db.query.auditLog.findMany({
			where: { organizationId: { eq: ORG_ID } },
		});
		return rows.map((row) => ({
			action: row.action,
			userId: row.userId,
			resourceId: row.resourceId,
		}));
	}

	it("records discount creation and deletion", async () => {
		const created = await request(
			`/admin/organizations/${ORG_ID}/discounts`,
			"POST",
			{ provider: "openai", discountPercent: 20, reason: "pilot" },
		);
		expect(created.status).toBe(201);
		const { id } = await created.json();

		const deleted = await request(
			`/admin/organizations/${ORG_ID}/discounts/${id}`,
			"DELETE",
		);
		expect(deleted.status).toBe(200);

		expect(await auditActions()).toEqual(
			expect.arrayContaining([
				{ action: "discount.create", userId: "test-user-id", resourceId: id },
				{ action: "discount.delete", userId: "test-user-id", resourceId: id },
			]),
		);
	});

	it("records rate limit creation and deletion", async () => {
		const created = await request(
			`/admin/organizations/${ORG_ID}/rate-limits`,
			"POST",
			{ provider: "openai", limitType: "rpm", maxRequests: 10 },
		);
		expect(created.status).toBe(201);
		const { id } = await created.json();

		const deleted = await request(
			`/admin/organizations/${ORG_ID}/rate-limits/${id}`,
			"DELETE",
		);
		expect(deleted.status).toBe(200);

		expect(await auditActions()).toEqual(
			expect.arrayContaining([
				{ action: "rate_limit.create", userId: "test-user-id", resourceId: id },
				{ action: "rate_limit.delete", userId: "test-user-id", resourceId: id },
			]),
		);
	});

	it("records the unblock when a flagged account is approved", async () => {
		await db.insert(tables.user).values({
			id: "flagged-user",
			name: "Flagged",
			email: "flagged@example.com",
			emailVerified: true,
			riskStatus: "flagged",
		});
		await db.insert(tables.userOrganization).values({
			userId: "flagged-user",
			organizationId: ORG_ID,
			role: "owner",
		});
		await db
			.update(tables.organization)
			.set({ riskFlagged: true })
			.where(eq(tables.organization.id, ORG_ID));

		const approved = await request(
			"/admin/flagged-accounts/flagged-user/approve",
			"POST",
		);
		expect(approved.status).toBe(200);

		expect(await auditActions()).toEqual([
			{
				action: "organization.update",
				userId: "test-user-id",
				resourceId: ORG_ID,
			},
		]);
	});
});
