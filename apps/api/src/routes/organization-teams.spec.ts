import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

const ORGANIZATION_ID = "organization-team-test-org";
const OTHER_ORGANIZATION_ID = "organization-team-other-org";
const OWNER_MEMBERSHIP_ID = "organization-team-owner-membership";
const DEVELOPER_ID = "organization-team-developer";
const DEVELOPER_MEMBERSHIP_ID = "organization-team-developer-membership";
const PROJECT_ID = "organization-team-project";
const OTHER_PROJECT_ID = "organization-team-other-project";

describe("organization teams", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();
		await db.insert(tables.organization).values([
			{
				id: ORGANIZATION_ID,
				name: "Organization Team Test",
				plan: "enterprise",
				billingEmail: "billing@example.com",
			},
			{
				id: OTHER_ORGANIZATION_ID,
				name: "Other Organization Team Test",
				plan: "enterprise",
				billingEmail: "other-billing@example.com",
			},
		]);
		await db.insert(tables.userOrganization).values({
			id: OWNER_MEMBERSHIP_ID,
			userId: "test-user-id",
			organizationId: ORGANIZATION_ID,
			role: "owner",
		});
		await db.insert(tables.user).values({
			id: DEVELOPER_ID,
			name: "Team Developer",
			email: "team-developer@example.com",
			emailVerified: true,
		});
		await db.insert(tables.userOrganization).values({
			id: DEVELOPER_MEMBERSHIP_ID,
			userId: DEVELOPER_ID,
			organizationId: ORGANIZATION_ID,
			role: "developer",
		});
		await db.insert(tables.project).values([
			{
				id: PROJECT_ID,
				name: "Team Project",
				organizationId: ORGANIZATION_ID,
			},
			{
				id: OTHER_PROJECT_ID,
				name: "Other Team Project",
				organizationId: OTHER_ORGANIZATION_ID,
			},
		]);
	});

	afterEach(async () => {
		await deleteAll();
	});

	async function request(
		path: string,
		method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" = "GET",
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

	async function createTeam(name = "Inference") {
		const response = await request(`/team/${ORGANIZATION_ID}/teams`, "POST", {
			name,
		});
		expect(response.status).toBe(200);
		return (await response.json()).team as { id: string };
	}

	test("supports team policy CRUD and case-insensitive names", async () => {
		const team = await createTeam();

		const duplicate = await request(`/team/${ORGANIZATION_ID}/teams`, "POST", {
			name: "inference",
		});
		expect(duplicate.status).toBe(409);

		const projects = await request(
			`/team/${ORGANIZATION_ID}/teams/${team.id}/projects`,
			"PUT",
			{ projectIds: [PROJECT_ID] },
		);
		expect(projects.status).toBe(200);
		expect((await projects.json()).team.projects).toEqual([
			expect.objectContaining({ id: PROJECT_ID }),
		]);

		const budget = await request(
			`/team/${ORGANIZATION_ID}/teams/${team.id}/budget`,
			"PUT",
			{
				maxApiKeys: 2,
				usageLimit: "12",
				periodUsageLimit: "3",
				periodUsageDurationValue: 1,
				periodUsageDurationUnit: "day",
			},
		);
		expect(budget.status).toBe(200);
		expect((await budget.json()).team.budget).toMatchObject({
			maxApiKeys: 2,
			usageLimit: "12",
			periodUsageDurationUnit: "day",
		});

		const iam = await request(
			`/team/${ORGANIZATION_ID}/teams/${team.id}/iam`,
			"POST",
			{
				ruleType: "allow_providers",
				ruleValue: { providers: ["openai"] },
				status: "active",
			},
		);
		expect(iam.status).toBe(200);
		const ruleId = (await iam.json()).rule.id as string;

		const updated = await request(
			`/team/${ORGANIZATION_ID}/teams/${team.id}`,
			"PATCH",
			{ name: "Platform" },
		);
		expect(updated.status).toBe(200);

		expect(
			(
				await request(
					`/team/${ORGANIZATION_ID}/teams/${team.id}/iam/${ruleId}`,
					"DELETE",
				)
			).status,
		).toBe(200);
		expect(
			(await request(`/team/${ORGANIZATION_ID}/teams/${team.id}`, "DELETE"))
				.status,
		).toBe(200);
	});

	test("allows a zero-project suspension and rejects cross-org projects", async () => {
		const team = await createTeam();
		const empty = await request(
			`/team/${ORGANIZATION_ID}/teams/${team.id}/projects`,
			"PUT",
			{ projectIds: [] },
		);
		expect(empty.status).toBe(200);
		expect((await empty.json()).team.projects).toEqual([]);

		const crossOrg = await request(
			`/team/${ORGANIZATION_ID}/teams/${team.id}/projects`,
			"PUT",
			{ projectIds: [OTHER_PROJECT_ID] },
		);
		expect(crossOrg.status).toBe(400);
	});

	test("assigns only developers and requires an empty team for deletion", async () => {
		const team = await createTeam();
		const assign = await request(
			`/team/${ORGANIZATION_ID}/members/${DEVELOPER_MEMBERSHIP_ID}/team`,
			"PUT",
			{ teamId: team.id },
		);
		expect(assign.status).toBe(200);

		const ownerAssign = await request(
			`/team/${ORGANIZATION_ID}/members/${OWNER_MEMBERSHIP_ID}/team`,
			"PUT",
			{ teamId: team.id },
		);
		expect(ownerAssign.status).toBe(400);
		await expect(
			db
				.update(tables.userOrganization)
				.set({ teamId: team.id })
				.where(eq(tables.userOrganization.id, OWNER_MEMBERSHIP_ID)),
		).rejects.toThrow();

		const occupiedDelete = await request(
			`/team/${ORGANIZATION_ID}/teams/${team.id}`,
			"DELETE",
		);
		expect(occupiedDelete.status).toBe(409);

		const unassign = await request(
			`/team/${ORGANIZATION_ID}/members/${DEVELOPER_MEMBERSHIP_ID}/team`,
			"PUT",
			{ teamId: null },
		);
		expect(unassign.status).toBe(200);
		expect(
			(await request(`/team/${ORGANIZATION_ID}/teams/${team.id}`, "DELETE"))
				.status,
		).toBe(200);
	});

	test("rejects a team from another organization", async () => {
		const [otherTeam] = await db
			.insert(tables.organizationTeam)
			.values({
				organizationId: OTHER_ORGANIZATION_ID,
				name: "Other Team",
			})
			.returning();

		const response = await request(
			`/team/${ORGANIZATION_ID}/members/${DEVELOPER_MEMBERSHIP_ID}/team`,
			"PUT",
			{ teamId: otherTeam.id },
		);
		expect(response.status).toBe(404);
	});

	test("promoting a developer atomically removes their team", async () => {
		const team = await createTeam();
		await request(
			`/team/${ORGANIZATION_ID}/members/${DEVELOPER_MEMBERSHIP_ID}/team`,
			"PUT",
			{ teamId: team.id },
		);

		const response = await request(
			`/team/${ORGANIZATION_ID}/members/${DEVELOPER_MEMBERSHIP_ID}`,
			"PATCH",
			{ role: "admin" },
		);
		expect(response.status, await response.clone().text()).toBe(200);
		const membership = await db.query.userOrganization.findFirst({
			where: { id: { eq: DEVELOPER_MEMBERSHIP_ID } },
		});
		expect(membership).toMatchObject({ role: "admin", teamId: null });
	});

	test("after Enterprise lapses policy stays visible but only cleanup is allowed", async () => {
		const team = await createTeam();
		await request(
			`/team/${ORGANIZATION_ID}/members/${DEVELOPER_MEMBERSHIP_ID}/team`,
			"PUT",
			{ teamId: team.id },
		);
		await db
			.update(tables.organization)
			.set({ plan: "pro" })
			.where(eq(tables.organization.id, ORGANIZATION_ID));

		expect(
			(await request(`/team/${ORGANIZATION_ID}/teams/${team.id}`)).status,
		).toBe(200);
		expect(
			(
				await request(`/team/${ORGANIZATION_ID}/teams`, "POST", {
					name: "Blocked",
				})
			).status,
		).toBe(403);
		expect(
			(
				await request(
					`/team/${ORGANIZATION_ID}/teams/${team.id}/projects`,
					"PUT",
					{ projectIds: [PROJECT_ID] },
				)
			).status,
		).toBe(403);

		expect(
			(
				await request(
					`/team/${ORGANIZATION_ID}/members/${DEVELOPER_MEMBERSHIP_ID}/team`,
					"PUT",
					{ teamId: null },
				)
			).status,
		).toBe(200);
		expect(
			(await request(`/team/${ORGANIZATION_ID}/teams/${team.id}`, "DELETE"))
				.status,
		).toBe(200);
	});
});
