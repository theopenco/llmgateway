import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "@/index.js";
import { validateSsoSessionOrganization } from "@/lib/sso-access.js";
import { createApiKeyForProject } from "@/routes/keys-api.js";
import { createProjectForOrg } from "@/routes/projects.js";
import { createTestUser, deleteAll } from "@/testing.js";
import { autoJoinSsoProviderOrganization } from "@/utils/sso-domain.js";

import { db, eq, tables } from "@llmgateway/db";
import { getApiKeyFingerprint } from "@llmgateway/shared/api-key-hash";

const orgId = "pro-seat-test-org";
const token = "test-pro-scim-token";

async function provision(email: string, active = true) {
	return await app.request("/scim/v2/Users", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/scim+json",
		},
		body: JSON.stringify({ userName: email, active }),
	});
}

async function memberships() {
	return await db.query.userOrganization.findMany({
		where: { organizationId: { eq: orgId } },
	});
}

describe("paid Pro membership capacity", () => {
	beforeEach(async () => {
		await createTestUser();
		await db.insert(tables.organization).values({
			id: orgId,
			name: "Test Organization",
			billingEmail: "admin@example.com",
			plan: "pro",
			proSeats: 3,
			proSsoEnabled: true,
			proScimEnabled: true,
		});
		await db
			.insert(tables.userOrganization)
			.values({ organizationId: orgId, userId: "test-user-id", role: "owner" });
		await db.insert(tables.project).values({
			id: "pro-seat-test-project",
			name: "Test Project",
			organizationId: orgId,
		});
		await db.insert(tables.scimToken).values({
			organizationId: orgId,
			tokenHash: getApiKeyFingerprint(token),
			maskedToken: "test-token",
			createdBy: "test-user-id",
		});
	});
	afterEach(deleteAll);

	it("joins paid Pro SSO users without an Enterprise plan", async () => {
		await db.insert(tables.user).values({
			id: "pro-jit-user",
			email: "jit@example.com",
			name: "Test User",
			emailVerified: true,
		});
		expect(
			await autoJoinSsoProviderOrganization({
				userId: "pro-jit-user",
				email: "jit@example.com",
				organizationId: orgId,
				ssoProviderId: "test-sso",
			}),
		).toBe(orgId);
		expect(await memberships()).toHaveLength(2);
	});

	it("keeps an authenticated callback session for the paid SSO add-on", async () => {
		const session = await db.query.session.findFirst({
			where: { userId: { eq: "test-user-id" } },
		});
		expect(session).toBeDefined();
		expect(
			await validateSsoSessionOrganization(orgId, session!.id),
		).toBeUndefined();
		expect(
			await db.query.session.findFirst({ where: { id: { eq: session!.id } } }),
		).toBeDefined();
	});
	it("rejects a callback after SSO removal and deletes only its new session", async () => {
		const session = await db.query.session.findFirst({
			where: { userId: { eq: "test-user-id" } },
		});
		await db.insert(tables.session).values({
			id: "other-pro-test-session",
			token: "other-test-session-token",
			userId: "test-user-id",
			expiresAt: new Date(Date.now() + 60000),
		});
		await db
			.update(tables.organization)
			.set({ proSsoEnabled: false })
			.where(eq(tables.organization.id, orgId));
		expect(
			(await validateSsoSessionOrganization(orgId, session!.id))?.status,
		).toBe(403);
		expect(
			await db.query.session.findFirst({ where: { id: { eq: session!.id } } }),
		).toBeUndefined();
		expect(
			await db.query.session.findFirst({
				where: { id: { eq: "other-pro-test-session" } },
			}),
		).toBeDefined();
	});
	it("reserves pending invite seats during SCIM creation", async () => {
		await db.insert(tables.organizationInvite).values(
			["invite-one@example.com", "invite-two@example.com"].map((email) => ({
				organizationId: orgId,
				email,
				role: "admin" as const,
				invitedBy: "test-user-id",
				expiresAt: new Date(Date.now() + 60000),
			})),
		);
		expect((await provision("uninvited@example.com")).status).toBe(409);
		expect(await memberships()).toHaveLength(1);
	});

	it("admits only the purchased seats under concurrent SCIM creation", async () => {
		const responses = await Promise.all(
			[
				"one@example.com",
				"two@example.com",
				"three@example.com",
				"four@example.com",
			].map((email) => provision(email)),
		);
		expect(responses.map((r) => r.status).sort()).toEqual([201, 201, 409, 409]);
		expect(await memberships()).toHaveLength(3);
	});

	it("checks capacity when a staged SCIM user is reactivated", async () => {
		const staged = await provision("staged@example.com", false);
		expect(staged.status).toBe(201);
		const { id } = (await staged.json()) as { id: string };
		await provision("one@example.com");
		await provision("two@example.com");
		const response = await app.request(`/scim/v2/Users/${id}`, {
			method: "PATCH",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/scim+json",
			},
			body: JSON.stringify({
				Operations: [{ op: "replace", path: "active", value: true }],
			}),
		});
		expect(response.status).toBe(409);
		expect(await memberships()).toHaveLength(3);
	});

	it("revokes SCIM access when the add-on is removed", async () => {
		await db
			.update(tables.organization)
			.set({ proScimEnabled: false })
			.where(eq(tables.organization.id, orgId));
		expect((await provision("one@example.com")).status).toBe(403);
	});
});

describe("paid Pro resource races", () => {
	let cookie: string;
	beforeEach(async () => {
		cookie = await createTestUser();
		await db.insert(tables.organization).values({
			id: orgId,
			name: "Test Organization",
			billingEmail: "admin@example.com",
			plan: "pro",
			proSeats: 3,
			projectLimit: 2,
		});
		await db
			.insert(tables.userOrganization)
			.values({ organizationId: orgId, userId: "test-user-id", role: "owner" });
		await db.insert(tables.project).values({
			id: "pro-seat-test-project",
			name: "Test Project",
			organizationId: orgId,
		});
	});
	afterEach(deleteAll);
	it("serializes concurrent invitation reservations", async () => {
		const responses = await Promise.all(
			[1, 2, 3, 4].map((i) =>
				app.request(`/team/${orgId}/members`, {
					method: "POST",
					headers: { Cookie: cookie, "Content-Type": "application/json" },
					body: JSON.stringify({
						email: `invite-${i}@example.com`,
						role: "admin",
					}),
				}),
			),
		);
		expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 403, 403]);
	});
	it("serializes concurrent key creation", async () => {
		const results = await Promise.allSettled(
			[1, 2, 3, 4].map((i) =>
				createApiKeyForProject("pro-seat-test-project", "test-user-id", {
					description: `Test ${i}`,
				}),
			),
		);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
	});
	it("serializes concurrent project creation", async () => {
		const results = await Promise.allSettled(
			[1, 2, 3].map((i) =>
				createProjectForOrg(orgId, "test-user-id", { name: `Test ${i}` }),
			),
		);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
	});
	it("serializes single-key reactivation against purchased capacity", async () => {
		await db
			.update(tables.organization)
			.set({ proSeats: 4 })
			.where(eq(tables.organization.id, orgId));
		const keys = [];
		for (let i = 0; i < 4; i++) {
			keys.push(
				(
					await createApiKeyForProject(
						"pro-seat-test-project",
						"test-user-id",
						{ description: `Test ${i}` },
					)
				).apiKey,
			);
		}
		await db
			.update(tables.apiKey)
			.set({ status: "inactive" })
			.where(eq(tables.apiKey.projectId, "pro-seat-test-project"));
		await db
			.update(tables.organization)
			.set({ proSeats: 3 })
			.where(eq(tables.organization.id, orgId));
		const responses = await Promise.all(
			keys.map((key) =>
				app.request(`/keys/api/${key.id}`, {
					method: "PATCH",
					headers: { Cookie: cookie, "Content-Type": "application/json" },
					body: JSON.stringify({ status: "active" }),
				}),
			),
		);
		expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 200, 400]);
	});
	it("serializes bulk reactivation against purchased capacity", async () => {
		await db
			.update(tables.organization)
			.set({ proSeats: 4 })
			.where(eq(tables.organization.id, orgId));
		const keys = [];
		for (let i = 0; i < 4; i++) {
			keys.push(
				(
					await createApiKeyForProject(
						"pro-seat-test-project",
						"test-user-id",
						{ description: `Test ${i}` },
					)
				).apiKey,
			);
		}
		await db
			.update(tables.apiKey)
			.set({ status: "inactive" })
			.where(eq(tables.apiKey.projectId, "pro-seat-test-project"));
		await db
			.update(tables.organization)
			.set({ proSeats: 3 })
			.where(eq(tables.organization.id, orgId));
		await Promise.all(
			[keys.slice(0, 2), keys.slice(2)].map((group) =>
				app.request("/keys/api/bulk", {
					method: "POST",
					headers: { Cookie: cookie, "Content-Type": "application/json" },
					body: JSON.stringify({
						action: "reactivate",
						ids: group.map((k) => k.id),
					}),
				}),
			),
		);
		const active = await db.query.apiKey.findMany({
			where: {
				projectId: { eq: "pro-seat-test-project" },
				status: { eq: "active" },
			},
		});
		expect(active).toHaveLength(3);
	});
});
