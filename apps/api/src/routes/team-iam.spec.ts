import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

const ORG_ID = "iam-test-org";
const OWNER_UO_ID = "iam-owner-uo";
const MEMBER_USER_ID = "iam-member-user";
const MEMBER_EMAIL = "iam-member@example.com";
const MEMBER_UO_ID = "iam-member-uo";

// The scrypt hash from the createTestUser fixture; it hashes the password
// below and is not bound to an email, so it can be reused for other accounts.
const PASSWORD = "admin@example.com1A";
const PASSWORD_HASH =
	"c11ef27a7f9264be08db228ebb650888:a4d985a9c6bd98608237fd507534424950aa7fc255930d972242b81cbe78594f8568feb0d067e95ddf7be242ad3e9d013f695f4414fce68bfff091079f1dc460";

async function createAccountFor(userId: string, email: string) {
	await db.insert(tables.user).values({
		id: userId,
		name: "Member User",
		email,
		emailVerified: true,
	});
	await db.insert(tables.account).values({
		id: `${userId}-account`,
		providerId: "credential",
		accountId: `${userId}-account`,
		userId,
		password: PASSWORD_HASH,
	});
}

async function signInAs(email: string) {
	const auth = await app.request("/auth/sign-in/email", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, password: PASSWORD }),
	});
	expect(auth.status).toBe(200);
	return auth.headers.get("set-cookie")!;
}

describe("team member IAM rules", () => {
	let ownerToken: string;

	beforeEach(async () => {
		ownerToken = await createTestUser();

		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "IAM Test Organization",
			plan: "enterprise",
			billingEmail: "billing@example.com",
			autoTopUpEnabled: false,
			autoTopUpThreshold: "10",
			autoTopUpAmount: "10",
		});

		await db.insert(tables.userOrganization).values({
			id: OWNER_UO_ID,
			userId: "test-user-id",
			organizationId: ORG_ID,
			role: "owner",
		});

		await createAccountFor(MEMBER_USER_ID, MEMBER_EMAIL);
		await db.insert(tables.userOrganization).values({
			id: MEMBER_UO_ID,
			userId: MEMBER_USER_ID,
			organizationId: ORG_ID,
			role: "developer",
		});
	});

	afterEach(async () => {
		await deleteAll();
	});

	async function createRule(
		memberId: string,
		token: string,
		body: Record<string, unknown> = {
			ruleType: "allow_providers",
			ruleValue: { providers: ["openai"] },
		},
	) {
		return await app.request(`/team/${ORG_ID}/members/${memberId}/iam`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify(body),
		});
	}

	test("owner can create, list, update, and delete a member IAM rule", async () => {
		const createRes = await createRule(MEMBER_UO_ID, ownerToken);
		expect(createRes.status).toBe(200);
		const created = await createRes.json();
		expect(created.rule).toMatchObject({
			userOrganizationId: MEMBER_UO_ID,
			ruleType: "allow_providers",
			ruleValue: { providers: ["openai"] },
			status: "active",
		});

		const listRes = await app.request(
			`/team/${ORG_ID}/members/${MEMBER_UO_ID}/iam`,
			{ headers: { Cookie: ownerToken } },
		);
		expect(listRes.status).toBe(200);
		const listed = await listRes.json();
		expect(listed.rules).toHaveLength(1);

		const updateRes = await app.request(
			`/team/${ORG_ID}/members/${MEMBER_UO_ID}/iam/${created.rule.id}`,
			{
				method: "PATCH",
				headers: {
					"Content-Type": "application/json",
					Cookie: ownerToken,
				},
				body: JSON.stringify({ status: "inactive" }),
			},
		);
		expect(updateRes.status).toBe(200);
		const updated = await updateRes.json();
		expect(updated.rule.status).toBe("inactive");

		const deleteRes = await app.request(
			`/team/${ORG_ID}/members/${MEMBER_UO_ID}/iam/${created.rule.id}`,
			{
				method: "DELETE",
				headers: { Cookie: ownerToken },
			},
		);
		expect(deleteRes.status).toBe(200);

		const remaining = await db.query.userIamRule.findMany({
			where: { userOrganizationId: { eq: MEMBER_UO_ID } },
		});
		expect(remaining).toHaveLength(0);

		const auditActions = (
			await db.query.auditLog.findMany({
				where: { organizationId: { eq: ORG_ID } },
			})
		).map((log) => log.action);
		expect(auditActions).toEqual(
			expect.arrayContaining([
				"team_member.iam_rule.create",
				"team_member.iam_rule.update",
				"team_member.iam_rule.delete",
			]),
		);
	});

	test("developer cannot manage member IAM rules, even their own", async () => {
		const memberToken = await signInAs(MEMBER_EMAIL);

		const res = await createRule(MEMBER_UO_ID, memberToken);
		expect(res.status).toBe(403);

		const listRes = await app.request(
			`/team/${ORG_ID}/members/${MEMBER_UO_ID}/iam`,
			{ headers: { Cookie: memberToken } },
		);
		expect(listRes.status).toBe(403);
	});

	test("any member can read their own rules via /members/me/iam", async () => {
		const createRes = await createRule(MEMBER_UO_ID, ownerToken);
		expect(createRes.status).toBe(200);

		const memberToken = await signInAs(MEMBER_EMAIL);
		const res = await app.request(`/team/${ORG_ID}/members/me/iam`, {
			headers: { Cookie: memberToken },
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.rules).toHaveLength(1);
		expect(body.rules[0]).toMatchObject({
			ruleType: "allow_providers",
			userOrganizationId: MEMBER_UO_ID,
		});
	});

	test("admin cannot modify an owner's IAM rules", async () => {
		await db
			.update(tables.userOrganization)
			.set({ role: "admin" })
			.where(eq(tables.userOrganization.id, MEMBER_UO_ID));
		const adminToken = await signInAs(MEMBER_EMAIL);

		const res = await createRule(OWNER_UO_ID, adminToken);
		expect(res.status).toBe(403);
	});

	test("personal organizations cannot manage member IAM rules", async () => {
		await db
			.update(tables.organization)
			.set({ kind: "devpass" })
			.where(eq(tables.organization.id, ORG_ID));

		const res = await createRule(MEMBER_UO_ID, ownerToken);
		expect(res.status).toBe(403);
	});

	test("IP CIDR rules require an enterprise plan", async () => {
		await db
			.update(tables.organization)
			.set({ plan: "pro" })
			.where(eq(tables.organization.id, ORG_ID));

		const res = await createRule(MEMBER_UO_ID, ownerToken, {
			ruleType: "allow_ip_cidrs",
			ruleValue: { ipCidrs: ["192.0.2.0/24"] },
		});
		expect(res.status).toBe(403);

		await db
			.update(tables.organization)
			.set({ plan: "enterprise" })
			.where(eq(tables.organization.id, ORG_ID));

		const okRes = await createRule(MEMBER_UO_ID, ownerToken, {
			ruleType: "allow_ip_cidrs",
			ruleValue: { ipCidrs: ["192.0.2.0/24"] },
		});
		expect(okRes.status).toBe(200);
	});

	test("invalid CIDR values are rejected", async () => {
		const res = await createRule(MEMBER_UO_ID, ownerToken, {
			ruleType: "allow_ip_cidrs",
			ruleValue: { ipCidrs: ["not-a-cidr"] },
		});
		expect(res.status).toBe(400);
	});

	test("rules for an unknown member 404", async () => {
		const res = await createRule("nonexistent-member", ownerToken);
		expect(res.status).toBe(404);
	});

	test("removing the membership cascades its IAM rules", async () => {
		const createRes = await createRule(MEMBER_UO_ID, ownerToken);
		expect(createRes.status).toBe(200);

		await db
			.delete(tables.userOrganization)
			.where(eq(tables.userOrganization.id, MEMBER_UO_ID));

		const remaining = await db.query.userIamRule.findMany({
			where: { userOrganizationId: { eq: MEMBER_UO_ID } },
		});
		expect(remaining).toHaveLength(0);
	});
});
