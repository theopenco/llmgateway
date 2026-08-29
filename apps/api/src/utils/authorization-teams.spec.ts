import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

import { getUserProjectIds } from "./authorization.js";

describe("team project authorization", () => {
	beforeEach(async () => {
		await db.insert(tables.user).values({
			id: "team-project-user",
			name: "Team Project User",
			email: "team-project-user@example.com",
			emailVerified: true,
		});
		await db.insert(tables.organization).values({
			id: "team-project-org",
			name: "Team Project Organization",
			plan: "enterprise",
			billingEmail: "billing@example.com",
		});
		await db.insert(tables.project).values([
			{
				id: "team-project-a",
				name: "Project A",
				organizationId: "team-project-org",
			},
			{
				id: "team-project-b",
				name: "Project B",
				organizationId: "team-project-org",
			},
		]);
		await db.insert(tables.userOrganization).values({
			id: "team-project-membership",
			userId: "team-project-user",
			organizationId: "team-project-org",
			role: "developer",
		});
		await db.insert(tables.userProject).values([
			{
				userOrganizationId: "team-project-membership",
				projectId: "team-project-a",
			},
			{
				userOrganizationId: "team-project-membership",
				projectId: "team-project-b",
			},
		]);
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("intersects team grants and restores personal grants on unassignment", async () => {
		expect(await getUserProjectIds("team-project-user")).toEqual(
			expect.arrayContaining(["team-project-a", "team-project-b"]),
		);

		await db.insert(tables.organizationTeam).values({
			id: "team-project-team",
			organizationId: "team-project-org",
			name: "Restricted",
		});
		await db.insert(tables.organizationTeamProject).values({
			teamId: "team-project-team",
			projectId: "team-project-a",
		});
		await db
			.update(tables.userOrganization)
			.set({ teamId: "team-project-team" })
			.where(eq(tables.userOrganization.id, "team-project-membership"));

		expect(await getUserProjectIds("team-project-user")).toEqual([
			"team-project-a",
		]);

		await db
			.delete(tables.organizationTeamProject)
			.where(eq(tables.organizationTeamProject.teamId, "team-project-team"));
		expect(await getUserProjectIds("team-project-user")).toEqual([]);

		await db
			.update(tables.userOrganization)
			.set({ teamId: null })
			.where(eq(tables.userOrganization.id, "team-project-membership"));
		expect(await getUserProjectIds("team-project-user")).toEqual(
			expect.arrayContaining(["team-project-a", "team-project-b"]),
		);
	});
});
