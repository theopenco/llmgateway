import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";
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

describe("scim group project mapping", () => {
	beforeEach(async () => {
		await createTestUser();

		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "SCIM Org",
			billingEmail: "scim@example.com",
			autoTopUpEnabled: false,
			autoTopUpThreshold: "10",
			autoTopUpAmount: "10",
			// Legacy org that never saved the default-projects card: an empty
			// selection falls back to the oldest project. New orgs default to
			// true (deny until configured) — covered by its own test below.
			ssoDefaultProjectsConfigured: false,
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

		// The oldest project is the default-grant fallback; the mapped group
		// grants the other two instead.
		await db.insert(tables.project).values([
			{
				id: "scim-default-project",
				name: "Default Project",
				organizationId: ORG_ID,
				createdAt: new Date("2024-01-01"),
			},
			{
				id: "scim-mapped-project-1",
				name: "Mapped Project 1",
				organizationId: ORG_ID,
				createdAt: new Date("2024-01-02"),
			},
			{
				id: "scim-mapped-project-2",
				name: "Mapped Project 2",
				organizationId: ORG_ID,
				createdAt: new Date("2024-01-03"),
			},
		]);

		await db.insert(tables.ssoProjectMapping).values([
			{
				organizationId: ORG_ID,
				groupName: "Data",
				projectId: "scim-mapped-project-1",
			},
			{
				organizationId: ORG_ID,
				groupName: "Data",
				projectId: "scim-mapped-project-2",
			},
		]);
	});

	afterEach(async () => {
		await deleteAll();
	});

	async function provisionUser(email: string): Promise<string> {
		const response = await app.request("/scim/v2/Users", {
			method: "POST",
			headers: scimHeaders(),
			body: JSON.stringify({
				userName: email,
				emails: [{ value: email, primary: true }],
				active: true,
			}),
		});
		expect(response.status).toBe(201);
		const { id } = (await response.json()) as { id: string };
		return id;
	}

	async function getGrants(userId: string) {
		const membership = await db.query.userOrganization.findFirst({
			where: { userId: { eq: userId }, organizationId: { eq: ORG_ID } },
			columns: { id: true },
		});
		if (!membership) {
			return [];
		}
		const rows = await db.query.userProject.findMany({
			where: { userOrganizationId: { eq: membership.id } },
			columns: { projectId: true, source: true },
		});
		return rows.sort((a, b) => a.projectId.localeCompare(b.projectId));
	}

	test("provisioning without groups grants the default project as sso", async () => {
		const id = await provisionUser("nogroups@example.com");

		expect(await getGrants(id)).toEqual([
			{ projectId: "scim-default-project", source: "sso" },
		]);
	});

	test("configured org with empty defaults grants nothing on provision", async () => {
		// Orgs created after the ssoDefaultProjectsConfigured column shipped are
		// configured by default: with no defaults selected and no mapped groups,
		// provisioning must not fall back to the oldest project.
		await db
			.update(tables.organization)
			.set({ ssoDefaultProjectsConfigured: true })
			.where(eq(tables.organization.id, ORG_ID));

		const id = await provisionUser("denied@example.com");

		expect(await getGrants(id)).toEqual([]);
	});

	test("configured org still grants mapped projects via groups", async () => {
		await db
			.update(tables.organization)
			.set({ ssoDefaultProjectsConfigured: true })
			.where(eq(tables.organization.id, ORG_ID));

		const id = await provisionUser("denied-then-mapped@example.com");
		expect(await getGrants(id)).toEqual([]);

		const response = await app.request("/scim/v2/Groups", {
			method: "POST",
			headers: scimHeaders(),
			body: JSON.stringify({
				displayName: "Data",
				members: [{ value: id }],
			}),
		});
		expect(response.status).toBe(201);

		expect(await getGrants(id)).toEqual([
			{ projectId: "scim-mapped-project-1", source: "sso" },
			{ projectId: "scim-mapped-project-2", source: "sso" },
		]);
	});

	test("adding a member to a mapped group replaces default grants", async () => {
		const id = await provisionUser("mapped@example.com");

		const response = await app.request("/scim/v2/Groups", {
			method: "POST",
			headers: scimHeaders(),
			body: JSON.stringify({
				displayName: "Data",
				members: [{ value: id }],
			}),
		});
		expect(response.status).toBe(201);

		expect(await getGrants(id)).toEqual([
			{ projectId: "scim-mapped-project-1", source: "sso" },
			{ projectId: "scim-mapped-project-2", source: "sso" },
		]);

		const logs = await db.query.auditLog.findMany({
			where: {
				organizationId: { eq: ORG_ID },
				action: { eq: "scim.user.project_change" },
			},
		});
		// Two events exist for this user: the provision-time default grant and the
		// group-add replacement — assert on the latter.
		const change = logs.find(
			(log) =>
				log.metadata?.targetUserId === id &&
				Array.isArray(log.metadata?.projectsRemoved) &&
				log.metadata.projectsRemoved.length > 0,
		);
		expect(change?.metadata?.projectsAdded).toEqual(
			expect.arrayContaining([
				"scim-mapped-project-1",
				"scim-mapped-project-2",
			]),
		);
		expect(change?.metadata?.projectsRemoved).toEqual(["scim-default-project"]);
	});

	test("removing a member from a group revokes sso grants but keeps manual ones", async () => {
		const id = await provisionUser("leaver@example.com");

		// An admin manually granted one of the mapped projects; that grant must
		// survive the group removal.
		const membership = await db.query.userOrganization.findFirst({
			where: { userId: { eq: id }, organizationId: { eq: ORG_ID } },
			columns: { id: true },
		});
		await db.insert(tables.userProject).values({
			userOrganizationId: membership!.id,
			projectId: "scim-mapped-project-1",
			source: "manual",
		});

		const created = await app.request("/scim/v2/Groups", {
			method: "POST",
			headers: scimHeaders(),
			body: JSON.stringify({
				displayName: "Data",
				members: [{ value: id }],
			}),
		});
		expect(created.status).toBe(201);
		const { id: groupId } = (await created.json()) as { id: string };

		// The manual row wins the conflict and keeps its source.
		expect(await getGrants(id)).toEqual([
			{ projectId: "scim-mapped-project-1", source: "manual" },
			{ projectId: "scim-mapped-project-2", source: "sso" },
		]);

		const response = await app.request(`/scim/v2/Groups/${groupId}`, {
			method: "PATCH",
			headers: scimHeaders(),
			body: JSON.stringify({
				schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
				Operations: [{ op: "remove", path: `members[value eq "${id}"]` }],
			}),
		});
		expect(response.status).toBe(200);

		// Back to the default fallback; the manual grant survives.
		expect(await getGrants(id)).toEqual([
			{ projectId: "scim-default-project", source: "sso" },
			{ projectId: "scim-mapped-project-1", source: "manual" },
		]);
	});

	test("deleting a mapped group reverts members to default grants", async () => {
		const id = await provisionUser("reverted@example.com");

		const created = await app.request("/scim/v2/Groups", {
			method: "POST",
			headers: scimHeaders(),
			body: JSON.stringify({
				displayName: "Data",
				members: [{ value: id }],
			}),
		});
		const { id: groupId } = (await created.json()) as { id: string };

		const response = await app.request(`/scim/v2/Groups/${groupId}`, {
			method: "DELETE",
			headers: scimHeaders(),
		});
		expect(response.status).toBe(204);

		expect(await getGrants(id)).toEqual([
			{ projectId: "scim-default-project", source: "sso" },
		]);
	});

	test("reactivation re-grants mapped projects", async () => {
		const id = await provisionUser("rejoiner@example.com");

		await app.request("/scim/v2/Groups", {
			method: "POST",
			headers: scimHeaders(),
			body: JSON.stringify({
				displayName: "Data",
				members: [{ value: id }],
			}),
		});

		const deactivate = await app.request(`/scim/v2/Users/${id}`, {
			method: "PATCH",
			headers: scimHeaders(),
			body: JSON.stringify({
				schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
				Operations: [{ op: "replace", path: "active", value: false }],
			}),
		});
		expect(deactivate.status).toBe(200);

		// Deactivation removes the membership, cascading all project grants.
		expect(await getGrants(id)).toEqual([]);

		const reactivate = await app.request(`/scim/v2/Users/${id}`, {
			method: "PATCH",
			headers: scimHeaders(),
			body: JSON.stringify({
				schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
				Operations: [{ op: "replace", path: "active", value: true }],
			}),
		});
		expect(reactivate.status).toBe(200);

		// Group membership persisted across deactivation, so the mapped projects
		// come back instead of the default fallback.
		expect(await getGrants(id)).toEqual([
			{ projectId: "scim-mapped-project-1", source: "sso" },
			{ projectId: "scim-mapped-project-2", source: "sso" },
		]);
	});
});
