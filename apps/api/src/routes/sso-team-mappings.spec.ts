import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

const ORGANIZATION_ID = "sso-team-mapping-org";
const OTHER_ORGANIZATION_ID = "sso-team-mapping-other-org";
const DEVELOPER_ID = "sso-team-mapping-developer";
const DEVELOPER_MEMBERSHIP_ID = "sso-team-mapping-membership";
const GROUP_ID = "sso-team-mapping-group";
const FIRST_TEAM_ID = "sso-team-mapping-first";
const SECOND_TEAM_ID = "sso-team-mapping-second";
const OTHER_TEAM_ID = "sso-team-mapping-other";

describe("sso team mappings", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();
		await db.insert(tables.organization).values([
			{
				id: ORGANIZATION_ID,
				name: "SSO Team Mapping Org",
				billingEmail: "mapping@example.com",
				plan: "enterprise",
			},
			{
				id: OTHER_ORGANIZATION_ID,
				name: "Other SSO Team Mapping Org",
				billingEmail: "other-mapping@example.com",
				plan: "enterprise",
			},
		]);
		await db.insert(tables.userOrganization).values({
			userId: "test-user-id",
			organizationId: ORGANIZATION_ID,
			role: "owner",
		});
		await db.insert(tables.organizationTeam).values([
			{
				id: FIRST_TEAM_ID,
				organizationId: ORGANIZATION_ID,
				name: "Data",
			},
			{
				id: SECOND_TEAM_ID,
				organizationId: ORGANIZATION_ID,
				name: "Platform",
			},
			{
				id: OTHER_TEAM_ID,
				organizationId: OTHER_ORGANIZATION_ID,
				name: "Other",
			},
		]);
		await db.insert(tables.user).values({
			id: DEVELOPER_ID,
			name: "Mapped Developer",
			email: "mapped-developer@example.com",
			emailVerified: true,
		});
		await db.insert(tables.userOrganization).values({
			id: DEVELOPER_MEMBERSHIP_ID,
			userId: DEVELOPER_ID,
			organizationId: ORGANIZATION_ID,
			role: "developer",
		});
		await db.insert(tables.scimGroup).values({
			id: GROUP_ID,
			organizationId: ORGANIZATION_ID,
			displayName: "Engineering",
		});
		await db.insert(tables.scimGroupMember).values({
			scimGroupId: GROUP_ID,
			userId: DEVELOPER_ID,
		});
	});

	afterEach(async () => {
		await deleteAll();
	});

	async function request(
		path: string,
		method: "GET" | "POST" | "DELETE" = "GET",
		body?: unknown,
	) {
		return await app.request(path, {
			method,
			headers: {
				Cookie: token,
				...(body ? { "Content-Type": "application/json" } : {}),
			},
			body: body ? JSON.stringify(body) : undefined,
		});
	}

	async function saveMapping(teamId: string) {
		return await request("/sso/team-mappings", "POST", {
			organizationId: ORGANIZATION_ID,
			groupName: "Engineering",
			teamId,
		});
	}

	test("lists teams and saves a mapping for current group members", async () => {
		const initial = await request(
			`/sso/team-mappings?organizationId=${ORGANIZATION_ID}`,
		);
		expect(initial.status).toBe(200);
		expect(await initial.json()).toMatchObject({
			mappings: [],
			teams: expect.arrayContaining([
				{ id: FIRST_TEAM_ID, name: "Data" },
				{ id: SECOND_TEAM_ID, name: "Platform" },
			]),
		});

		const response = await saveMapping(FIRST_TEAM_ID);
		expect(response.status).toBe(201);
		expect(await response.json()).toMatchObject({
			mapping: {
				groupName: "Engineering",
				teamId: FIRST_TEAM_ID,
				teamName: "Data",
			},
		});

		const membership = await db.query.userOrganization.findFirst({
			where: { id: { eq: DEVELOPER_MEMBERSHIP_ID } },
			columns: { teamId: true, teamAssignmentSource: true },
		});
		expect(membership).toEqual({
			teamId: FIRST_TEAM_ID,
			teamAssignmentSource: "sso",
		});
	});

	test("saving the same group replaces its team", async () => {
		expect((await saveMapping(FIRST_TEAM_ID)).status).toBe(201);
		expect((await saveMapping(SECOND_TEAM_ID)).status).toBe(201);

		const mappings = await db.query.ssoTeamMapping.findMany({
			where: { organizationId: { eq: ORGANIZATION_ID } },
		});
		expect(mappings).toHaveLength(1);
		expect(mappings[0]?.teamId).toBe(SECOND_TEAM_ID);
		const membership = await db.query.userOrganization.findFirst({
			where: { id: { eq: DEVELOPER_MEMBERSHIP_ID } },
			columns: { teamId: true },
		});
		expect(membership?.teamId).toBe(SECOND_TEAM_ID);
	});

	test("deleting a mapping removes only a synced assignment", async () => {
		const created = await saveMapping(FIRST_TEAM_ID);
		const { mapping } = (await created.json()) as { mapping: { id: string } };
		const response = await request(
			`/sso/team-mappings/${mapping.id}?organizationId=${ORGANIZATION_ID}`,
			"DELETE",
		);
		expect(response.status).toBe(200);

		const membership = await db.query.userOrganization.findFirst({
			where: { id: { eq: DEVELOPER_MEMBERSHIP_ID } },
			columns: { teamId: true, teamAssignmentSource: true },
		});
		expect(membership).toEqual({
			teamId: null,
			teamAssignmentSource: "manual",
		});
	});

	test("manual team assignments survive mapping changes", async () => {
		await db
			.update(tables.userOrganization)
			.set({ teamId: SECOND_TEAM_ID, teamAssignmentSource: "manual" })
			.where(eq(tables.userOrganization.id, DEVELOPER_MEMBERSHIP_ID));

		const created = await saveMapping(FIRST_TEAM_ID);
		const { mapping } = (await created.json()) as { mapping: { id: string } };
		expect(
			await db.query.userOrganization.findFirst({
				where: { id: { eq: DEVELOPER_MEMBERSHIP_ID } },
				columns: { teamId: true, teamAssignmentSource: true },
			}),
		).toEqual({
			teamId: SECOND_TEAM_ID,
			teamAssignmentSource: "manual",
		});

		expect(
			(
				await request(
					`/sso/team-mappings/${mapping.id}?organizationId=${ORGANIZATION_ID}`,
					"DELETE",
				)
			).status,
		).toBe(200);
		expect(
			await db.query.userOrganization.findFirst({
				where: { id: { eq: DEVELOPER_MEMBERSHIP_ID } },
				columns: { teamId: true },
			}),
		).toEqual({ teamId: SECOND_TEAM_ID });
	});

	test("rejects foreign teams and requires Enterprise access", async () => {
		expect((await saveMapping(OTHER_TEAM_ID)).status).toBe(400);
		await db
			.update(tables.organization)
			.set({ plan: "pro" })
			.where(eq(tables.organization.id, ORGANIZATION_ID));
		expect(
			(await request(`/sso/team-mappings?organizationId=${ORGANIZATION_ID}`))
				.status,
		).toBe(403);
	});

	test("deleting an unknown mapping returns 404", async () => {
		const response = await request(
			`/sso/team-mappings/missing?organizationId=${ORGANIZATION_ID}`,
			"DELETE",
		);
		expect(response.status).toBe(404);
	});
});
