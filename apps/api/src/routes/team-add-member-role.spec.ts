import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";
import * as emailUtils from "@/utils/email.js";

import { db, eq, tables } from "@llmgateway/db";

const ORG_ID = "add-member-role-test-org";

describe("POST /team/:organizationId/members role check", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();
		vi.spyOn(emailUtils, "sendTransactionalEmail").mockResolvedValue(undefined);

		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Add Member Role Test Organization",
			plan: "enterprise",
			billingEmail: "billing@example.com",
		});

		await db.insert(tables.userOrganization).values({
			userId: "test-user-id",
			organizationId: ORG_ID,
			role: "developer",
		});
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await deleteAll();
	});

	async function addMember(body: Record<string, unknown>) {
		return await app.request(`/team/${ORG_ID}/members`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify(body),
		});
	}

	test("rejects a non-admin before validating project ids", async () => {
		const response = await addMember({
			email: "invited@example.com",
			role: "developer",
			projectIds: ["project-from-another-org"],
		});

		expect(response.status).toBe(403);
		const body = await response.json();
		expect(body.message).toBe("Only owners and admins can add members");
	});

	test("rejects a non-admin before the seat limit check", async () => {
		await db
			.update(tables.organization)
			.set({ seats: 1 })
			.where(eq(tables.organization.id, ORG_ID));

		const response = await addMember({
			email: "invited@example.com",
			role: "admin",
		});

		expect(response.status).toBe(403);
		const body = await response.json();
		expect(body.message).toBe("Only owners and admins can add members");
		expect(await db.query.organizationInvite.findMany()).toHaveLength(0);
	});
});
