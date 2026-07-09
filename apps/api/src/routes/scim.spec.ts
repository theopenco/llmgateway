import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";
import { getApiKeyFingerprint } from "@llmgateway/shared/api-key-hash";

const SCIM_TOKEN = "scim_test_token_abcdef0123456789";
const ORG_ID = "scim-test-org";

function scimHeaders(extra: Record<string, string> = {}) {
	return {
		Authorization: `Bearer ${SCIM_TOKEN}`,
		"Content-Type": "application/scim+json",
		...extra,
	};
}

describe("scim audit logging", () => {
	beforeEach(async () => {
		// createTestUser seeds `test-user-id`; it is the SCIM token's creator and
		// therefore the audit-log actor for IdP-initiated syncs.
		await createTestUser();

		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "SCIM Org",
			billingEmail: "scim@example.com",
			autoTopUpEnabled: false,
			autoTopUpThreshold: "10",
			autoTopUpAmount: "10",
		});

		await db.insert(tables.userOrganization).values({
			userId: "test-user-id",
			organizationId: ORG_ID,
			role: "owner",
		});

		await db.insert(tables.scimToken).values({
			tokenHash: getApiKeyFingerprint(SCIM_TOKEN),
			maskedToken: "scim_test...6789",
			organizationId: ORG_ID,
			createdBy: "test-user-id",
		});
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("POST /Users logs scim.user.provision", async () => {
		const response = await app.request("/scim/v2/Users", {
			method: "POST",
			headers: scimHeaders(),
			body: JSON.stringify({
				schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
				userName: "jane@example.com",
				externalId: "ext-jane",
				name: { givenName: "Jane", familyName: "Doe" },
				emails: [{ value: "jane@example.com", primary: true }],
				active: true,
			}),
		});

		expect(response.status).toBe(201);

		const logs = await db.query.auditLog.findMany({
			where: {
				organizationId: { eq: ORG_ID },
				action: { eq: "scim.user.provision" },
			},
		});

		expect(logs).toHaveLength(1);
		expect(logs[0]?.userId).toBe("test-user-id");
		expect(logs[0]?.resourceType).toBe("scim_user");
		expect(logs[0]?.metadata?.source).toBe("scim");
		expect(logs[0]?.metadata?.targetUserEmail).toBe("jane@example.com");
	});

	test("POST /Users creates the user without an account row", async () => {
		const created = await app.request("/scim/v2/Users", {
			method: "POST",
			headers: scimHeaders(),
			body: JSON.stringify({
				userName: "eve@example.com",
				externalId: "ext-eve",
				emails: [{ value: "eve@example.com", primary: true }],
				active: true,
			}),
		});
		const { id } = (await created.json()) as { id: string };

		const user = await db.query.user.findFirst({
			where: { id: { eq: id } },
		});
		expect(user?.emailVerified).toBe(true);

		// The account link is created by Better Auth on the user's first SAML
		// sign-in (implicit linking via the verified provider domain), not by
		// SCIM provisioning — a pre-created row could never match the id the
		// IdP asserts at login.
		const accounts = await db.query.account.findMany({
			where: { userId: { eq: id } },
		});
		expect(accounts).toHaveLength(0);
	});

	test("DELETE /Users logs scim.user.deprovision", async () => {
		const created = await app.request("/scim/v2/Users", {
			method: "POST",
			headers: scimHeaders(),
			body: JSON.stringify({
				userName: "bob@example.com",
				emails: [{ value: "bob@example.com", primary: true }],
				active: true,
			}),
		});
		const { id } = (await created.json()) as { id: string };

		const response = await app.request(`/scim/v2/Users/${id}`, {
			method: "DELETE",
			headers: scimHeaders(),
		});

		expect(response.status).toBe(204);

		const logs = await db.query.auditLog.findMany({
			where: {
				organizationId: { eq: ORG_ID },
				action: { eq: "scim.user.deprovision" },
			},
		});

		expect(logs).toHaveLength(1);
		expect(logs[0]?.metadata?.targetUserId).toBe(id);
	});

	test("DELETE /Users revokes the deprovisioned member's API keys", async () => {
		const created = await app.request("/scim/v2/Users", {
			method: "POST",
			headers: scimHeaders(),
			body: JSON.stringify({
				userName: "erin@example.com",
				emails: [{ value: "erin@example.com", primary: true }],
				active: true,
			}),
		});
		const { id } = (await created.json()) as { id: string };

		await db.insert(tables.project).values({
			id: "scim-test-project",
			name: "SCIM Project",
			organizationId: ORG_ID,
		});

		await db.insert(tables.apiKey).values({
			id: "scim-test-key",
			token: "scim-test-key-token",
			description: "erin key",
			projectId: "scim-test-project",
			createdBy: id,
		});

		const response = await app.request(`/scim/v2/Users/${id}`, {
			method: "DELETE",
			headers: scimHeaders(),
		});

		expect(response.status).toBe(204);

		const key = await db.query.apiKey.findFirst({
			where: { id: { eq: "scim-test-key" } },
			columns: { status: true },
		});
		expect(key?.status).toBe("deleted");
	});

	test("PATCH /Users deactivation revokes the member's API keys", async () => {
		const created = await app.request("/scim/v2/Users", {
			method: "POST",
			headers: scimHeaders(),
			body: JSON.stringify({
				userName: "frank@example.com",
				emails: [{ value: "frank@example.com", primary: true }],
				active: true,
			}),
		});
		const { id } = (await created.json()) as { id: string };

		await db.insert(tables.project).values({
			id: "scim-test-project-2",
			name: "SCIM Project 2",
			organizationId: ORG_ID,
		});

		await db.insert(tables.apiKey).values({
			id: "scim-test-key-2",
			token: "scim-test-key-token-2",
			description: "frank key",
			projectId: "scim-test-project-2",
			createdBy: id,
		});

		const response = await app.request(`/scim/v2/Users/${id}`, {
			method: "PATCH",
			headers: scimHeaders(),
			body: JSON.stringify({
				schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
				Operations: [{ op: "replace", path: "active", value: false }],
			}),
		});

		expect(response.status).toBe(200);

		const key = await db.query.apiKey.findFirst({
			where: { id: { eq: "scim-test-key-2" } },
			columns: { status: true },
		});
		expect(key?.status).toBe("deleted");
	});

	test("PATCH /Users deactivation logs scim.user.deactivate", async () => {
		const created = await app.request("/scim/v2/Users", {
			method: "POST",
			headers: scimHeaders(),
			body: JSON.stringify({
				userName: "carol@example.com",
				emails: [{ value: "carol@example.com", primary: true }],
				active: true,
			}),
		});
		const { id } = (await created.json()) as { id: string };

		const response = await app.request(`/scim/v2/Users/${id}`, {
			method: "PATCH",
			headers: scimHeaders(),
			body: JSON.stringify({
				schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
				Operations: [{ op: "replace", path: "active", value: false }],
			}),
		});

		expect(response.status).toBe(200);

		const logs = await db.query.auditLog.findMany({
			where: {
				organizationId: { eq: ORG_ID },
				action: { eq: "scim.user.deactivate" },
			},
		});

		expect(logs).toHaveLength(1);
		expect(logs[0]?.metadata?.targetUserId).toBe(id);
	});

	test("POST /Groups logs scim.group.create", async () => {
		const response = await app.request("/scim/v2/Groups", {
			method: "POST",
			headers: scimHeaders(),
			body: JSON.stringify({
				schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
				displayName: "Engineering",
			}),
		});

		expect(response.status).toBe(201);

		const logs = await db.query.auditLog.findMany({
			where: {
				organizationId: { eq: ORG_ID },
				action: { eq: "scim.group.create" },
			},
		});

		expect(logs).toHaveLength(1);
		expect(logs[0]?.resourceType).toBe("scim_group");
		expect(logs[0]?.metadata?.resourceName).toBe("Engineering");
	});

	test("group role mapping logs scim.user.role_change", async () => {
		await db.insert(tables.ssoRoleMapping).values({
			organizationId: ORG_ID,
			groupName: "Admins",
			role: "admin",
		});

		const created = await app.request("/scim/v2/Users", {
			method: "POST",
			headers: scimHeaders(),
			body: JSON.stringify({
				userName: "dave@example.com",
				emails: [{ value: "dave@example.com", primary: true }],
				active: true,
			}),
		});
		const { id } = (await created.json()) as { id: string };

		const response = await app.request("/scim/v2/Groups", {
			method: "POST",
			headers: scimHeaders(),
			body: JSON.stringify({
				displayName: "Admins",
				members: [{ value: id }],
			}),
		});

		expect(response.status).toBe(201);

		const logs = await db.query.auditLog.findMany({
			where: {
				organizationId: { eq: ORG_ID },
				action: { eq: "scim.user.role_change" },
			},
		});

		expect(logs).toHaveLength(1);
		expect(logs[0]?.metadata?.targetUserId).toBe(id);
		expect(logs[0]?.metadata?.changes).toMatchObject({
			role: { old: "developer", new: "admin" },
		});

		const membership = await db.query.userOrganization.findFirst({
			where: { userId: { eq: id }, organizationId: { eq: ORG_ID } },
			columns: { role: true },
		});
		expect(membership?.role).toBe("admin");
	});

	test("POST /Users auto-accepts pending team invites for the new user", async () => {
		// A second org invited this email before the account existed.
		await db.insert(tables.organization).values({
			id: "invite-org",
			name: "Inviting Org",
			billingEmail: "inviting@example.com",
			autoTopUpEnabled: false,
			autoTopUpThreshold: "10",
			autoTopUpAmount: "10",
		});
		await db.insert(tables.organizationInvite).values({
			id: "scim-invite-id",
			organizationId: "invite-org",
			email: "carol@example.com",
			role: "admin",
			expiresAt: new Date(Date.now() + 86_400_000),
		});

		const response = await app.request("/scim/v2/Users", {
			method: "POST",
			headers: scimHeaders(),
			body: JSON.stringify({
				userName: "carol@example.com",
				emails: [{ value: "carol@example.com", primary: true }],
				active: true,
			}),
		});

		expect(response.status).toBe(201);
		const { id } = (await response.json()) as { id: string };

		// Provisioned in the SCIM org AND auto-joined the inviting org.
		const memberships = await db.query.userOrganization.findMany({
			where: { userId: { eq: id } },
		});
		expect(memberships).toHaveLength(2);
		const invitedMembership = memberships.find(
			(m) => m.organizationId === "invite-org",
		);
		expect(invitedMembership?.role).toBe("admin");

		const invite = await db.query.organizationInvite.findFirst({
			where: { id: { eq: "scim-invite-id" } },
		});
		expect(invite?.status).toBe("accepted");
		expect(invite?.acceptedByUserId).toBe(id);
	});
});
