import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

const ORG_ID = "sso-mapping-org";

describe("sso project mappings", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();

		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Mapping Org",
			billingEmail: "mapping@example.com",
			plan: "enterprise",
			// Legacy org: an empty default selection falls back to the oldest
			// project (the DELETE-recompute test below relies on this). The
			// explicit/configured behavior has its own describe below.
			ssoDefaultProjectsConfigured: false,
		});

		await db.insert(tables.userOrganization).values({
			userId: "test-user-id",
			organizationId: ORG_ID,
			role: "owner",
		});

		await db.insert(tables.project).values([
			{
				id: "mapping-project-1",
				name: "Project 1",
				organizationId: ORG_ID,
			},
			{
				id: "mapping-project-2",
				name: "Project 2",
				organizationId: ORG_ID,
			},
		]);
	});

	afterEach(async () => {
		await deleteAll();
	});

	async function listMappings() {
		const response = await app.request(
			`/sso/project-mappings?organizationId=${ORG_ID}`,
			{ headers: { Cookie: token } },
		);
		expect(response.status).toBe(200);
		return (await response.json()) as {
			mappings: { groupName: string; projectIds: string[] }[];
			projects: { id: string; name: string }[];
		};
	}

	test("GET returns the org's projects and no mappings initially", async () => {
		const body = await listMappings();
		expect(body.mappings).toEqual([]);
		expect(body.projects.map((p) => p.id)).toEqual(
			expect.arrayContaining(["mapping-project-1", "mapping-project-2"]),
		);
	});

	test("POST creates a mapping and re-posting replaces the set", async () => {
		const created = await app.request("/sso/project-mappings", {
			method: "POST",
			headers: { Cookie: token, "Content-Type": "application/json" },
			body: JSON.stringify({
				organizationId: ORG_ID,
				groupName: "Data",
				projectIds: ["mapping-project-1", "mapping-project-2"],
			}),
		});
		expect(created.status).toBe(201);

		let body = await listMappings();
		expect(body.mappings).toEqual([
			{
				groupName: "Data",
				projectIds: expect.arrayContaining([
					"mapping-project-1",
					"mapping-project-2",
				]),
			},
		]);

		const replaced = await app.request("/sso/project-mappings", {
			method: "POST",
			headers: { Cookie: token, "Content-Type": "application/json" },
			body: JSON.stringify({
				organizationId: ORG_ID,
				groupName: "Data",
				projectIds: ["mapping-project-2"],
			}),
		});
		expect(replaced.status).toBe(201);

		body = await listMappings();
		expect(body.mappings).toEqual([
			{ groupName: "Data", projectIds: ["mapping-project-2"] },
		]);
	});

	test("POST rejects projects outside the organization", async () => {
		await db.insert(tables.organization).values({
			id: "other-org",
			name: "Other Org",
			billingEmail: "other@example.com",
		});
		await db.insert(tables.project).values({
			id: "foreign-project",
			name: "Foreign",
			organizationId: "other-org",
		});

		const response = await app.request("/sso/project-mappings", {
			method: "POST",
			headers: { Cookie: token, "Content-Type": "application/json" },
			body: JSON.stringify({
				organizationId: ORG_ID,
				groupName: "Data",
				projectIds: ["foreign-project"],
			}),
		});
		expect(response.status).toBe(400);
	});

	test("mappings require an enterprise plan", async () => {
		await db
			.update(tables.organization)
			.set({ plan: "pro" })
			.where(eq(tables.organization.id, ORG_ID));

		const response = await app.request(
			`/sso/project-mappings?organizationId=${ORG_ID}`,
			{ headers: { Cookie: token } },
		);
		expect(response.status).toBe(403);
	});

	test("DELETE removes the group's mapping and recomputes members", async () => {
		// A SCIM-pushed group with one member holding the mapped grant.
		await db.insert(tables.user).values({
			id: "mapped-member",
			name: "Mapped Member",
			email: "mapped-member@example.com",
			emailVerified: true,
		});
		const [membership] = await db
			.insert(tables.userOrganization)
			.values({
				userId: "mapped-member",
				organizationId: ORG_ID,
				role: "developer",
			})
			.returning({ id: tables.userOrganization.id });
		const [group] = await db
			.insert(tables.scimGroup)
			.values({ organizationId: ORG_ID, displayName: "Data" })
			.returning({ id: tables.scimGroup.id });
		await db.insert(tables.scimGroupMember).values({
			scimGroupId: group.id,
			userId: "mapped-member",
		});
		await db.insert(tables.ssoProjectMapping).values({
			organizationId: ORG_ID,
			groupName: "Data",
			projectId: "mapping-project-2",
		});
		await db.insert(tables.userProject).values({
			userOrganizationId: membership.id,
			projectId: "mapping-project-2",
			source: "sso",
		});

		const response = await app.request(
			`/sso/project-mappings?organizationId=${ORG_ID}&groupName=Data`,
			{ method: "DELETE", headers: { Cookie: token } },
		);
		expect(response.status).toBe(200);

		const rows = await db.query.ssoProjectMapping.findMany({
			where: { organizationId: { eq: ORG_ID } },
		});
		expect(rows).toEqual([]);

		// The member falls back to the org's default (oldest) project.
		const grants = await db.query.userProject.findMany({
			where: { userOrganizationId: { eq: membership.id } },
			columns: { projectId: true, source: true },
		});
		expect(grants).toEqual([{ projectId: "mapping-project-1", source: "sso" }]);
	});

	test("DELETE of an unknown group returns 404", async () => {
		const response = await app.request(
			`/sso/project-mappings?organizationId=${ORG_ID}&groupName=Nope`,
			{ method: "DELETE", headers: { Cookie: token } },
		);
		expect(response.status).toBe(404);
	});
});

describe("sso default projects configuration", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();

		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Mapping Org",
			billingEmail: "mapping@example.com",
			plan: "enterprise",
			ssoDefaultProjectsConfigured: false,
		});

		await db.insert(tables.userOrganization).values({
			userId: "test-user-id",
			organizationId: ORG_ID,
			role: "owner",
		});

		await db
			.insert(tables.project)
			.values([
				{ id: "mapping-project-1", name: "Project 1", organizationId: ORG_ID },
			]);
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("GET reports the org's configured state", async () => {
		const response = await app.request(
			`/sso/default-projects?organizationId=${ORG_ID}`,
			{ headers: { Cookie: token } },
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { configured: boolean };
		expect(body.configured).toBe(false);
	});

	test("PUT with an empty selection makes deny-by-default authoritative", async () => {
		const response = await app.request("/sso/default-projects", {
			method: "PUT",
			headers: { Cookie: token, "Content-Type": "application/json" },
			body: JSON.stringify({ organizationId: ORG_ID, projectIds: [] }),
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			configured: boolean;
			selectedProjectIds: string[];
		};
		expect(body.configured).toBe(true);
		expect(body.selectedProjectIds).toEqual([]);

		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
			columns: { ssoDefaultProjectsConfigured: true },
		});
		expect(org?.ssoDefaultProjectsConfigured).toBe(true);
	});
});
