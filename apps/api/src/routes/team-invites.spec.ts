import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";
import * as emailUtils from "@/utils/email.js";

import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

const ORG_ID = "invite-test-org";
const INVITED_EMAIL = "invited@example.com";

// The scrypt hash from the createTestUser fixture; it hashes the password
// below and is not bound to an email, so it can be reused for other accounts.
const PASSWORD = "admin@example.com1A";
const PASSWORD_HASH =
	"c11ef27a7f9264be08db228ebb650888:a4d985a9c6bd98608237fd507534424950aa7fc255930d972242b81cbe78594f8568feb0d067e95ddf7be242ad3e9d013f695f4414fce68bfff091079f1dc460";

async function createAccountFor(userId: string, email: string) {
	await db.insert(tables.user).values({
		id: userId,
		name: "Invited User",
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

// Signing in creates a new session, which runs the auth after-hook that
// auto-accepts pending invites.
async function signInAs(email: string, cookie?: string) {
	return await app.request("/auth/sign-in/email", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(cookie ? { Cookie: cookie } : {}),
		},
		body: JSON.stringify({ email, password: PASSWORD }),
	});
}

describe("team invites", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();
		vi.spyOn(emailUtils, "sendTransactionalEmail").mockResolvedValue(undefined);

		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Invite Test Organization",
			plan: "enterprise",
			billingEmail: "billing@example.com",
			autoTopUpEnabled: false,
			autoTopUpThreshold: "10",
			autoTopUpAmount: "10",
		});

		await db.insert(tables.userOrganization).values({
			userId: "test-user-id",
			organizationId: ORG_ID,
			role: "owner",
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

	test.each([false, true])(
		"creates the same pending invitation when registered=%s",
		async (registered) => {
			let recipientToken: string | null = null;
			if (registered) {
				await createAccountFor("invited-user-id", INVITED_EMAIL);
				const signIn = await signInAs(INVITED_EMAIL);
				expect(signIn.status).toBe(200);
				recipientToken = signIn.headers.get("set-cookie");
			}
			vi.mocked(emailUtils.sendTransactionalEmail).mockClear();

			const response = await addMember({ email: INVITED_EMAIL, role: "admin" });
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body).toEqual({
				message: "Invitation sent",
				member: null,
				invite: {
					id: expect.any(String),
					email: INVITED_EMAIL,
					role: "admin",
					projects: null,
					createdAt: expect.any(String),
					expiresAt: expect.any(String),
				},
			});

			const listed = await app.request(`/team/${ORG_ID}/members`, {
				headers: { Cookie: token },
			});
			expect(listed.status).toBe(200);
			const listing = await listed.json();
			expect(listing.members).toHaveLength(1);
			expect(listing.members[0].userId).toBe("test-user-id");
			expect(listing.invites).toEqual([body.invite]);

			const invite = await db.query.organizationInvite.findFirst({
				where: { organizationId: { eq: ORG_ID } },
			});
			expect(invite).toMatchObject({
				email: INVITED_EMAIL,
				role: "admin",
				status: "pending",
				invitedBy: "test-user-id",
				acceptedAt: null,
				acceptedByUserId: null,
			});
			expect(emailUtils.sendTransactionalEmail).toHaveBeenCalledExactlyOnceWith(
				{
					to: INVITED_EMAIL,
					organizationId: ORG_ID,
					subject:
						"You've been invited to Invite Test Organization on LLM Gateway",
					text: expect.stringContaining("/login?reauthenticate=true"),
				},
			);

			if (recipientToken) {
				const access = await app.request(`/team/${ORG_ID}/members`, {
					headers: { Cookie: recipientToken },
				});
				expect(access.status).toBe(403);
			}

			const auditLogs = await db.query.auditLog.findMany({
				where: { organizationId: { eq: ORG_ID } },
			});
			expect(auditLogs).toHaveLength(1);
			expect(auditLogs[0]?.action).toBe("team_member.invite");
		},
	);

	test("invite emails are normalized to lowercase", async () => {
		const response = await addMember({
			email: "Invited@Example.com",
			role: "admin",
		});

		expect(response.status).toBe(200);
		const invite = await db.query.organizationInvite.findFirst({
			where: { organizationId: { eq: ORG_ID } },
		});
		expect(invite?.email).toBe(INVITED_EMAIL);
	});

	test("registration does not change duplicate invitation behavior", async () => {
		await addMember({ email: INVITED_EMAIL, role: "admin" });
		await createAccountFor("invited-user-id", INVITED_EMAIL);
		const response = await addMember({ email: INVITED_EMAIL, role: "admin" });

		expect(response.status).toBe(400);
		expect((await response.json()).message).toBe(
			"An invitation for this email is already pending",
		);
	});

	test.each(["developer", "project_admin", "outsider"] as const)(
		"%s cannot invite members",
		async (role) => {
			if (role === "outsider") {
				await db
					.delete(tables.userOrganization)
					.where(eq(tables.userOrganization.organizationId, ORG_ID));
			} else {
				await db
					.update(tables.userOrganization)
					.set({ role })
					.where(eq(tables.userOrganization.organizationId, ORG_ID));
			}
			expect(
				(await addMember({ email: INVITED_EMAIL, role: "admin" })).status,
			).toBe(403);
			expect(await db.query.organizationInvite.findMany()).toHaveLength(0);
			expect(emailUtils.sendTransactionalEmail).not.toHaveBeenCalled();
		},
	);

	test("admins cannot invite owners", async () => {
		await db
			.update(tables.userOrganization)
			.set({ role: "admin" })
			.where(eq(tables.userOrganization.organizationId, ORG_ID));
		expect(
			(await addMember({ email: INVITED_EMAIL, role: "owner" })).status,
		).toBe(403);
		expect(await db.query.organizationInvite.findMany()).toHaveLength(0);
	});

	test("already joined members cannot be invited again", async () => {
		expect(
			(await addMember({ email: "ADMIN@EXAMPLE.COM", role: "admin" })).status,
		).toBe(400);
		expect(await db.query.organizationInvite.findMany()).toHaveLength(0);
	});

	test("pending invites are listed and count toward the seat limit", async () => {
		await addMember({ email: INVITED_EMAIL, role: "admin" });

		const response = await app.request(`/team/${ORG_ID}/members`, {
			headers: { Cookie: token },
		});
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.invites).toHaveLength(1);
		expect(body.invites[0]).toMatchObject({
			email: INVITED_EMAIL,
			role: "admin",
		});

		// Owner + pending invite fill both seats.
		await db
			.update(tables.organization)
			.set({ seats: 2 })
			.where(eq(tables.organization.id, ORG_ID));

		const overLimit = await addMember({
			email: "another@example.com",
			role: "admin",
		});
		expect(overLimit.status).toBe(403);
	});

	test("playground session keys do not count as active developer keys", async () => {
		await db.insert(tables.project).values({
			id: "invite-test-project",
			name: "Invite Test Project",
			organizationId: ORG_ID,
		});
		await db.insert(tables.apiKey).values([
			{
				id: "developer-key",
				...hashApiKeyForStorage("developer-token"),
				projectId: "invite-test-project",
				description: "Developer key",
				createdBy: "test-user-id",
			},
			{
				id: "playground-session-key",
				...hashApiKeyForStorage("playground-session-token"),
				projectId: "invite-test-project",
				description: "Session key",
				kind: "playground",
				createdBy: "test-user-id",
			},
		]);

		const response = await app.request(`/team/${ORG_ID}/members`, {
			headers: { Cookie: token },
		});
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.members[0]?.spend.activeApiKeys).toBe(1);
	});

	test.each([false, true])(
		"pending invite is accepted on sign-in when registered=%s",
		async (registered) => {
			if (registered) {
				await createAccountFor("invited-user-id", INVITED_EMAIL);
			}
			await addMember({ email: INVITED_EMAIL, role: "admin" });
			if (!registered) {
				await createAccountFor("invited-user-id", INVITED_EMAIL);
			}
			const signIn = await signInAs(INVITED_EMAIL);
			expect(signIn.status).toBe(200);

			const memberships = await db.query.userOrganization.findMany({
				where: { userId: { eq: "invited-user-id" } },
			});
			// Joined the invited org only — no personal default org was created.
			expect(memberships).toHaveLength(1);
			expect(memberships[0]).toMatchObject({
				organizationId: ORG_ID,
				role: "admin",
			});

			const invite = await db.query.organizationInvite.findFirst({
				where: { organizationId: { eq: ORG_ID } },
			});
			expect(invite?.status).toBe("accepted");
			expect(invite?.acceptedByUserId).toBe("invited-user-id");

			const auditLogs = await db.query.auditLog.findMany({
				where: {
					organizationId: { eq: ORG_ID },
					action: { eq: "team_member.invite_accept" },
				},
			});
			expect(auditLogs).toHaveLength(1);
		},
	);

	test("an existing session accepts an invitation only after signing in again", async () => {
		await createAccountFor("invited-user-id", INVITED_EMAIL);
		const initialSignIn = await signInAs(INVITED_EMAIL);
		expect(initialSignIn.status).toBe(200);
		const cookie = initialSignIn.headers.get("set-cookie")!;
		await addMember({ email: INVITED_EMAIL, role: "admin" });

		const session = await app.request("/auth/get-session", {
			headers: { Cookie: cookie },
		});
		expect(session.status).toBe(200);
		expect((await session.json()).user.email).toBe(INVITED_EMAIL);
		const pending = await db.query.organizationInvite.findFirst({
			where: { organizationId: { eq: ORG_ID } },
		});
		expect(pending?.status).toBe("pending");

		const signIn = await signInAs(INVITED_EMAIL, cookie);
		expect(signIn.status).toBe(200);
		const accepted = await db.query.organizationInvite.findFirst({
			where: { organizationId: { eq: ORG_ID } },
		});
		expect(accepted).toMatchObject({
			status: "accepted",
			acceptedByUserId: "invited-user-id",
		});
	});

	test("developer invite grants the invited projects at acceptance", async () => {
		await db.insert(tables.project).values({
			id: "invite-test-project",
			name: "Invite Test Project",
			organizationId: ORG_ID,
		});

		await addMember({
			email: INVITED_EMAIL,
			role: "developer",
			projectIds: ["invite-test-project"],
		});

		await createAccountFor("invited-user-id", INVITED_EMAIL);
		const signIn = await signInAs(INVITED_EMAIL);
		expect(signIn.status).toBe(200);

		const membership = await db.query.userOrganization.findFirst({
			where: {
				userId: { eq: "invited-user-id" },
				organizationId: { eq: ORG_ID },
			},
		});
		expect(membership?.role).toBe("developer");

		const grants = await db.query.userProject.findMany({
			where: { userOrganizationId: { eq: membership!.id } },
		});
		expect(grants).toHaveLength(1);
		expect(grants[0]?.projectId).toBe("invite-test-project");
	});

	test("accepted developer invite joins the default team", async () => {
		await db.insert(tables.organizationTeam).values({
			id: "invite-default-team",
			organizationId: ORG_ID,
			name: "Standard",
			isDefault: true,
		});
		await db.insert(tables.project).values({
			id: "invite-default-project",
			name: "Invite Default Project",
			organizationId: ORG_ID,
		});

		await addMember({
			email: INVITED_EMAIL,
			role: "developer",
			projectIds: ["invite-default-project"],
		});
		await createAccountFor("invited-user-id", INVITED_EMAIL);
		const signIn = await signInAs(INVITED_EMAIL);
		expect(signIn.status).toBe(200);

		const membership = await db.query.userOrganization.findFirst({
			where: {
				userId: { eq: "invited-user-id" },
				organizationId: { eq: ORG_ID },
			},
			columns: { role: true, teamId: true, teamAssignmentSource: true },
		});
		expect(membership).toEqual({
			role: "developer",
			teamId: "invite-default-team",
			teamAssignmentSource: "default",
		});
	});

	test("revoked invite is not accepted on sign-in", async () => {
		const created = await addMember({ email: INVITED_EMAIL, role: "admin" });
		const { invite } = await created.json();

		const revoke = await app.request(`/team/${ORG_ID}/invites/${invite.id}`, {
			method: "DELETE",
			headers: { Cookie: token },
		});
		expect(revoke.status).toBe(200);

		await createAccountFor("invited-user-id", INVITED_EMAIL);
		const signIn = await signInAs(INVITED_EMAIL);
		expect(signIn.status).toBe(200);

		const membership = await db.query.userOrganization.findFirst({
			where: {
				userId: { eq: "invited-user-id" },
				organizationId: { eq: ORG_ID },
			},
		});
		expect(membership).toBeUndefined();

		const row = await db.query.organizationInvite.findFirst({
			where: { id: { eq: invite.id } },
		});
		expect(row?.status).toBe("revoked");
	});

	test("expired invite is not accepted on sign-in", async () => {
		const created = await addMember({ email: INVITED_EMAIL, role: "admin" });
		const { invite } = await created.json();

		await db
			.update(tables.organizationInvite)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(tables.organizationInvite.id, invite.id));

		await createAccountFor("invited-user-id", INVITED_EMAIL);
		const signIn = await signInAs(INVITED_EMAIL);
		expect(signIn.status).toBe(200);

		const membership = await db.query.userOrganization.findFirst({
			where: {
				userId: { eq: "invited-user-id" },
				organizationId: { eq: ORG_ID },
			},
		});
		expect(membership).toBeUndefined();
	});

	test("developers cannot revoke invites", async () => {
		const created = await addMember({ email: INVITED_EMAIL, role: "admin" });
		const { invite } = await created.json();

		await createAccountFor("dev-user-id", "dev@example.com");
		await db.insert(tables.userOrganization).values({
			userId: "dev-user-id",
			organizationId: ORG_ID,
			role: "developer",
		});
		const devSignIn = await signInAs("dev@example.com");
		const devToken = devSignIn.headers.get("set-cookie")!;

		const revoke = await app.request(`/team/${ORG_ID}/invites/${invite.id}`, {
			method: "DELETE",
			headers: { Cookie: devToken },
		});
		expect(revoke.status).toBe(403);
	});
});
