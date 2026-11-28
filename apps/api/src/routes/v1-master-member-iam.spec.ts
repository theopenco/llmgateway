import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";
import { getApiKeyFingerprint } from "@llmgateway/shared/api-key-hash";

const ORG_ID = "mk-iam-org";
const OWNER_UO_ID = "mk-iam-owner-uo";
const ADMIN_USER_ID = "mk-iam-admin-user";
const ADMIN_UO_ID = "mk-iam-admin-uo";
const MEMBER_USER_ID = "mk-iam-member-user";
const MEMBER_UO_ID = "mk-iam-member-uo";
const OWNER_RULE_ID = "mk-iam-owner-rule";

describe("master key member IAM issuer role", () => {
	let adminToken: string;

	beforeEach(async () => {
		await createTestUser();

		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Master IAM Organization",
			plan: "enterprise",
			billingEmail: "billing@example.com",
		});

		await db.insert(tables.user).values([
			{
				id: ADMIN_USER_ID,
				name: "Admin User",
				email: "mk-iam-admin@example.com",
				emailVerified: true,
			},
			{
				id: MEMBER_USER_ID,
				name: "Member User",
				email: "mk-iam-member@example.com",
				emailVerified: true,
			},
		]);

		await db.insert(tables.userOrganization).values([
			{
				id: OWNER_UO_ID,
				userId: "test-user-id",
				organizationId: ORG_ID,
				role: "owner",
			},
			{
				id: ADMIN_UO_ID,
				userId: ADMIN_USER_ID,
				organizationId: ORG_ID,
				role: "admin",
			},
			{
				id: MEMBER_UO_ID,
				userId: MEMBER_USER_ID,
				organizationId: ORG_ID,
				role: "developer",
			},
		]);

		await db.insert(tables.userIamRule).values({
			id: OWNER_RULE_ID,
			userOrganizationId: OWNER_UO_ID,
			ruleType: "allow_providers",
			ruleValue: { providers: ["openai"] },
		});

		adminToken = `mk-${crypto.randomUUID()}`;
		await db.insert(tables.masterKey).values({
			id: "mk-iam-admin-key",
			tokenHash: getApiKeyFingerprint(adminToken),
			maskedToken: "mk-****",
			description: "Admin Master Key",
			status: "active",
			organizationId: ORG_ID,
			createdBy: ADMIN_USER_ID,
		});
	});

	afterEach(async () => {
		await deleteAll();
	});

	function request(path: string, method: string, body?: unknown) {
		return app.request(`/v1/master/members/${path}`, {
			method,
			headers: {
				Authorization: `Bearer ${adminToken}`,
				"Content-Type": "application/json",
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	}

	test("admin-issued key cannot create, update or delete owner rules", async () => {
		const createRes = await request(`${OWNER_UO_ID}/iam`, "POST", {
			ruleType: "deny_providers",
			ruleValue: { providers: ["openai"] },
		});
		expect(createRes.status).toBe(403);

		const updateRes = await request(
			`${OWNER_UO_ID}/iam/${OWNER_RULE_ID}`,
			"PATCH",
			{ status: "inactive" },
		);
		expect(updateRes.status).toBe(403);

		const deleteRes = await request(
			`${OWNER_UO_ID}/iam/${OWNER_RULE_ID}`,
			"DELETE",
		);
		expect(deleteRes.status).toBe(403);

		const ownerRules = await db.query.userIamRule.findMany({
			where: { userOrganizationId: { eq: OWNER_UO_ID } },
		});
		expect(ownerRules).toHaveLength(1);
		expect(ownerRules[0].status).toBe("active");
	});

	test("admin-issued key cannot list owner rules", async () => {
		const res = await request(`${OWNER_UO_ID}/iam`, "GET");
		expect(res.status).toBe(403);
		expect(JSON.stringify(await res.json())).not.toContain(OWNER_RULE_ID);
	});

	test("admin-issued key can still manage non-owner rules", async () => {
		const createRes = await request(`${MEMBER_UO_ID}/iam`, "POST", {
			ruleType: "allow_providers",
			ruleValue: { providers: ["openai"] },
		});
		expect(createRes.status).toBe(201);

		const listRes = await request(`${MEMBER_UO_ID}/iam`, "GET");
		expect(listRes.status).toBe(200);
		expect((await listRes.json()).rules).toHaveLength(1);
	});

	test.each(["demoted", "removed"] as const)(
		"key whose issuer was %s cannot read or modify member rules",
		async (change) => {
			if (change === "removed") {
				await db
					.delete(tables.userOrganization)
					.where(eq(tables.userOrganization.id, ADMIN_UO_ID));
			} else {
				await db
					.update(tables.userOrganization)
					.set({ role: "developer" })
					.where(eq(tables.userOrganization.id, ADMIN_UO_ID));
			}

			const createRes = await request(`${MEMBER_UO_ID}/iam`, "POST", {
				ruleType: "allow_providers",
				ruleValue: { providers: ["openai"] },
			});
			expect(createRes.status).toBe(403);

			const listRes = await request(`${MEMBER_UO_ID}/iam`, "GET");
			expect(listRes.status).toBe(403);
		},
	);
});
