import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

describe("organization route", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();

		await db.insert(tables.organization).values({
			id: "test-org-id",
			name: "Test Organization",
			billingEmail: "test@example.com",
			autoTopUpEnabled: false,
			autoTopUpThreshold: "10",
			autoTopUpAmount: "10",
		});

		await db.insert(tables.userOrganization).values({
			userId: "test-user-id",
			organizationId: "test-org-id",
			role: "owner",
		});
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("PATCH /orgs/{id} logs enabling auto top-up in audit log", async () => {
		const response = await app.request("/orgs/test-org-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				autoTopUpEnabled: true,
			}),
		});

		expect(response.status).toBe(200);

		const auditLogs = await db.query.auditLog.findMany({
			where: {
				organizationId: {
					eq: "test-org-id",
				},
				action: {
					eq: "payment.auto_topup.update",
				},
			},
		});

		expect(auditLogs).toHaveLength(1);
		expect(auditLogs[0]?.userId).toBe("test-user-id");
		expect(auditLogs[0]?.resourceId).toBe("test-org-id");
		expect(auditLogs[0]?.metadata).toMatchObject({
			changes: {
				autoTopUpEnabled: {
					old: false,
					new: true,
				},
			},
		});
	});

	test("PATCH /orgs/{id} logs top-up setting changes separately from organization updates", async () => {
		const response = await app.request("/orgs/test-org-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				name: "Renamed Organization",
				autoTopUpThreshold: 25,
				autoTopUpAmount: 50,
			}),
		});

		expect(response.status).toBe(200);

		const orgAuditLogs = await db.query.auditLog.findMany({
			where: {
				organizationId: {
					eq: "test-org-id",
				},
				action: {
					eq: "organization.update",
				},
			},
		});
		expect(orgAuditLogs).toHaveLength(1);
		expect(orgAuditLogs[0]?.metadata).toMatchObject({
			changes: {
				name: {
					old: "Test Organization",
					new: "Renamed Organization",
				},
			},
		});

		const autoTopUpAuditLogs = await db.query.auditLog.findMany({
			where: {
				organizationId: {
					eq: "test-org-id",
				},
				action: {
					eq: "payment.auto_topup.update",
				},
			},
		});
		expect(autoTopUpAuditLogs).toHaveLength(1);
		expect(autoTopUpAuditLogs[0]?.metadata).toMatchObject({
			changes: {
				autoTopUpThreshold: {
					old: "10",
					new: "25",
				},
				autoTopUpAmount: {
					old: "10",
					new: "50",
				},
			},
		});
	});
});
