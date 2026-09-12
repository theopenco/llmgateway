import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { acceptPendingInvitesForUser } from "@/lib/team-invites.js";
import { createTestUser, deleteAll } from "@/testing.js";
import {
	getAdminOrganizationIds,
	getApiKeyScope,
	getUserProjectIds,
} from "@/utils/authorization.js";

import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

const orgId = "project-admin-org";
const membershipId = "project-admin-membership";
const projectId = "assigned-project";
const otherProjectId = "unassigned-project";

describe("project admin access", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();
		await db.insert(tables.organization).values({
			id: orgId,
			name: "Project Admin Organization",
			billingEmail: "billing@example.com",
			plan: "enterprise",
		});
		await db.insert(tables.user).values({
			id: "project-peer",
			name: "Project Peer",
			email: "project-peer@example.com",
			emailVerified: true,
		});
		await db.insert(tables.userOrganization).values({
			id: membershipId,
			userId: "test-user-id",
			organizationId: orgId,
			role: "project_admin",
		});
		await db.insert(tables.project).values(
			[projectId, otherProjectId].map((id) => ({
				id,
				name: id,
				organizationId: orgId,
				paymentsSdkEnabled: true,
			})),
		);
		await db.insert(tables.userProject).values({
			userOrganizationId: membershipId,
			projectId,
		});
		await db.insert(tables.apiKey).values(
			[projectId, otherProjectId].map((id) => ({
				id: `${id}-key`,
				...hashApiKeyForStorage(`${id}-token`),
				projectId: id,
				createdBy: "project-peer",
				description: "Peer key",
			})),
		);
	});

	afterEach(deleteAll);

	function request(path: string, method = "GET", body?: unknown) {
		return app.request(path, {
			method,
			headers: { Cookie: token, "Content-Type": "application/json" },
			...(body !== undefined ? { body: JSON.stringify(body) } : {}),
		});
	}

	test("grants project-wide usage only inside assigned projects", async () => {
		const projects = await getUserProjectIds("test-user-id");
		expect(projects).toContain(projectId);
		expect(projects).not.toContain(otherProjectId);
		expect(await getAdminOrganizationIds("test-user-id")).not.toContain(orgId);
		expect(await getApiKeyScope("test-user-id", [projectId])).toEqual({
			privilegedProjectIds: [projectId],
			restrictedProjectIds: [],
			ownApiKeyIds: [],
		});
		const response = await request(`/orgs/${orgId}/projects`);
		expect(response.status).toBe(200);
		expect(
			(await response.json()).projects.map((p: { id: string }) => p.id),
		).toEqual([projectId]);
	});

	test("manages project preferences, routing, and Payments SDK settings", async () => {
		const settings = {
			name: "Managed project",
			cachingEnabled: true,
			cacheDurationSeconds: 120,
			mode: "hybrid",
			defaultRoutingStrategy: "latency",
			endUserEnabled: true,
			allowedOrigins: ["https://example.com"],
		};
		const response = await request(`/projects/${projectId}`, "PATCH", settings);
		expect(response.status).toBe(200);
		expect((await response.json()).project).toMatchObject(settings);
		const routing = await request(
			`/routing-config/config/${projectId}`,
			"PUT",
			{
				weights: { price: 2 },
			},
		);
		expect(routing.status).toBe(200);
		expect((await routing.json()).weights).toMatchObject({ price: 2 });
		expect((await request(`/dynamic-routes/${projectId}`)).status).toBe(200);
	});

	test("manages project guardrails and reads inherited policy", async () => {
		await db.insert(tables.guardrailConfig).values({
			organizationId: orgId,
			enabled: true,
			maxFileSizeMb: 8,
		});
		const inherited = await request(
			`/guardrails/projects/${projectId}/inherited`,
		);
		expect(inherited.status).toBe(200);
		expect((await inherited.json()).config).toMatchObject({ maxFileSizeMb: 8 });
		const response = await request(
			`/guardrails/projects/${projectId}/config`,
			"PUT",
			{
				inheritOrganization: false,
				enabled: true,
				maxFileSizeMb: 4,
			},
		);
		expect(response.status).toBe(200);
		expect((await response.json()).maxFileSizeMb).toBe(4);
		expect(
			(await request(`/guardrails/config/${orgId}`, "PUT", { enabled: false }))
				.status,
		).toBe(403);
		expect((await request(`/guardrails/config/${orgId}`)).status).toBe(403);
	});

	test("lists and manages other members' keys in assigned projects", async () => {
		const response = await request("/keys/api");
		expect(response.status).toBe(200);
		const ids = (await response.json()).apiKeys.map(
			(key: { id: string }) => key.id,
		);
		expect(ids).toContain(`${projectId}-key`);
		expect(ids).not.toContain(`${otherProjectId}-key`);
		expect(
			(
				await request(`/keys/api/${projectId}-key`, "PATCH", {
					description: "Managed key",
				})
			).status,
		).toBe(200);
		expect((await request(`/keys/api/${projectId}-key/iam`)).status).toBe(200);
		expect((await request(`/keys/api/${projectId}-key`, "DELETE")).status).toBe(
			200,
		);
	});

	test.each([
		["GET", `/projects/${otherProjectId}`, undefined],
		["PATCH", `/projects/${otherProjectId}`, { name: "Blocked" }],
		["GET", `/keys/api?projectId=${otherProjectId}`, undefined],
		["PATCH", `/keys/api/${otherProjectId}-key`, { description: "Blocked" }],
		["DELETE", `/keys/api/${otherProjectId}-key`, undefined],
		["GET", `/keys/api/${otherProjectId}-key/iam`, undefined],
		["GET", `/routing-config/config/${otherProjectId}`, undefined],
		["GET", `/dynamic-routes/${otherProjectId}`, undefined],
		["GET", `/guardrails/projects/${otherProjectId}/config`, undefined],
		["GET", `/guardrails/projects/${otherProjectId}/inherited`, undefined],
	] as const)(
		"denies unassigned project access: %s %s",
		async (method, path, body) => {
			expect([403, 404]).toContain((await request(path, method, body)).status);
		},
	);

	test.each([
		["PATCH", `/orgs/${orgId}`, { name: "Blocked" }],
		["PATCH", `/orgs/${orgId}`, { billingEmail: "blocked@example.com" }],
		["DELETE", `/orgs/${orgId}`, undefined],
		["GET", `/orgs/${orgId}/transactions`, undefined],
		["GET", `/orgs/${orgId}/credits-runway`, undefined],
		["GET", `/orgs/${orgId}/limits`, undefined],
		["GET", `/analytics/members?organizationId=${orgId}`, undefined],
		[
			"POST",
			`/team/${orgId}/members`,
			{ email: "project-peer@example.com", role: "admin" },
		],
		["POST", "/projects", { name: "Blocked", organizationId: orgId }],
		["DELETE", `/projects/${projectId}`, undefined],
	] as const)(
		"denies organization administration: %s %s",
		async (method, path, body) => {
			expect((await request(path, method, body)).status).toBe(403);
		},
	);

	test("revoking a project grant removes key and settings access", async () => {
		await db
			.delete(tables.userProject)
			.where(eq(tables.userProject.userOrganizationId, membershipId));
		expect(await getUserProjectIds("test-user-id")).not.toContain(projectId);
		expect(
			(await request(`/projects/${projectId}`, "PATCH", { name: "Blocked" }))
				.status,
		).toBe(404);
		expect((await request(`/keys/api/${projectId}-key`, "DELETE")).status).toBe(
			404,
		);
	});

	test("developers keep their own-key scope and cannot edit settings", async () => {
		await db
			.update(tables.userOrganization)
			.set({ role: "developer" })
			.where(eq(tables.userOrganization.id, membershipId));
		expect(
			(await request(`/projects/${projectId}`, "PATCH", { name: "Blocked" }))
				.status,
		).toBe(403);
		const response = await request(`/keys/api?projectId=${projectId}`);
		expect((await response.json()).apiKeys).toEqual([]);
		expect((await request(`/keys/api/${projectId}-key`, "DELETE")).status).toBe(
			403,
		);
	});

	test("owners assign, change, and revoke project admin grants", async () => {
		await db
			.update(tables.userOrganization)
			.set({ role: "owner" })
			.where(eq(tables.userOrganization.id, membershipId));
		const add = await request(`/team/${orgId}/members`, "POST", {
			email: "project-peer@example.com",
			role: "project_admin",
			projectIds: [projectId],
		});
		expect(add.status).toBe(200);
		const { invite } = await add.json();
		expect(invite.projects).toEqual([{ id: projectId, name: projectId }]);
		expect(await getUserProjectIds("project-peer")).toEqual([]);
		await acceptPendingInvitesForUser({
			id: "project-peer",
			email: "project-peer@example.com",
		});
		const member = await db.query.userOrganization.findFirst({
			where: {
				userId: { eq: "project-peer" },
				organizationId: { eq: orgId },
			},
		});
		expect(member).toBeDefined();
		expect(await getUserProjectIds("project-peer")).toEqual([projectId]);
		const change = await request(
			`/team/${orgId}/members/${member!.id}`,
			"PATCH",
			{
				role: "project_admin",
				projectIds: [otherProjectId],
			},
		);
		expect(change.status).toBe(200);
		expect(await getUserProjectIds("project-peer")).toEqual([otherProjectId]);
		expect(
			(await request(`/team/${orgId}/members/${member!.id}`, "DELETE")).status,
		).toBe(200);
		expect(await getUserProjectIds("project-peer")).toEqual([]);
	});

	test.each([{ projectIds: [] }, { projectIds: ["missing-project"] }])(
		"requires valid grants when assigning project admins: %j",
		async ({ projectIds }) => {
			await db
				.update(tables.userOrganization)
				.set({ role: "owner" })
				.where(eq(tables.userOrganization.id, membershipId));
			expect(
				(
					await request(`/team/${orgId}/members`, "POST", {
						email: "project-peer@example.com",
						role: "project_admin",
						projectIds,
					})
				).status,
			).toBe(400);
		},
	);

	test("project admin assignments require Enterprise access", async () => {
		await db
			.update(tables.userOrganization)
			.set({ role: "owner" })
			.where(eq(tables.userOrganization.id, membershipId));
		await db
			.update(tables.organization)
			.set({ plan: "pro" })
			.where(eq(tables.organization.id, orgId));
		expect(
			(
				await request(`/team/${orgId}/members`, "POST", {
					email: "project-peer@example.com",
					role: "project_admin",
					projectIds: [projectId],
				})
			).status,
		).toBe(403);
	});

	test("promoting a developer clears team policy and replaces project grants", async () => {
		await db
			.update(tables.userOrganization)
			.set({ role: "owner" })
			.where(eq(tables.userOrganization.id, membershipId));
		await db.insert(tables.organizationTeam).values({
			id: "developer-team",
			organizationId: orgId,
			name: "Developers",
		});
		await db.insert(tables.userOrganization).values({
			id: "peer-membership",
			organizationId: orgId,
			userId: "project-peer",
			role: "developer",
			teamId: "developer-team",
		});
		await db
			.insert(tables.userProject)
			.values({ userOrganizationId: "peer-membership", projectId });
		const response = await request(
			`/team/${orgId}/members/peer-membership`,
			"PATCH",
			{
				role: "project_admin",
				projectIds: [otherProjectId],
			},
		);
		expect(response.status).toBe(200);
		expect((await response.json()).member).toMatchObject({
			role: "project_admin",
			team: null,
		});
		expect(await getUserProjectIds("project-peer")).toEqual([otherProjectId]);
		const member = await db.query.userOrganization.findFirst({
			where: { id: { eq: "peer-membership" } },
		});
		expect(member?.teamId).toBeNull();
	});

	test("accepts invitations with only the invited project grants", async () => {
		await db
			.update(tables.userOrganization)
			.set({ role: "owner" })
			.where(eq(tables.userOrganization.id, membershipId));
		const invite = await request(`/team/${orgId}/members`, "POST", {
			email: "invited-project-admin@example.com",
			role: "project_admin",
			projectIds: [projectId],
		});
		expect(invite.status).toBe(200);
		expect((await invite.json()).invite.projects).toEqual([
			{ id: projectId, name: projectId },
		]);
		await db.insert(tables.user).values({
			id: "invited-project-admin",
			name: "Invited Admin",
			email: "invited-project-admin@example.com",
			emailVerified: true,
		});
		await acceptPendingInvitesForUser({
			id: "invited-project-admin",
			email: "invited-project-admin@example.com",
		});
		expect(await getUserProjectIds("invited-project-admin")).toEqual([
			projectId,
		]);
		expect(await getAdminOrganizationIds("invited-project-admin")).toEqual([]);
	});
});
