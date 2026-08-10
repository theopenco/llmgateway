import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

const ORG_ID = "lead-test-org";
const OWNER_UO_ID = "lead-owner-uo";
const MEMBER_USER_ID = "lead-member-user";
const MEMBER_UO_ID = "lead-member-uo";
const PROJECT_A = "lead-project-a";
const PROJECT_B = "lead-project-b";

describe("team project lead grants", () => {
	let ownerToken: string;

	beforeEach(async () => {
		ownerToken = await createTestUser();

		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Lead Test Organization",
			plan: "enterprise",
			billingEmail: "billing@example.com",
		});

		await db.insert(tables.userOrganization).values({
			id: OWNER_UO_ID,
			userId: "test-user-id",
			organizationId: ORG_ID,
			role: "owner",
		});

		await db.insert(tables.user).values({
			id: MEMBER_USER_ID,
			name: "Lead Member",
			email: "lead-member@example.com",
			emailVerified: true,
		});

		await db.insert(tables.userOrganization).values({
			id: MEMBER_UO_ID,
			userId: MEMBER_USER_ID,
			organizationId: ORG_ID,
			role: "developer",
		});

		await db.insert(tables.project).values([
			{ id: PROJECT_A, name: "Project A", organizationId: ORG_ID },
			{ id: PROJECT_B, name: "Project B", organizationId: ORG_ID },
		]);
	});

	afterEach(async () => {
		await deleteAll();
	});

	async function updateAccess(body: Record<string, unknown>) {
		return await app.request(`/team/${ORG_ID}/members/${MEMBER_UO_ID}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json", Cookie: ownerToken },
			body: JSON.stringify(body),
		});
	}

	async function grantsFor(userOrganizationId: string) {
		const rows = await db.query.userProject.findMany({
			where: { userOrganizationId: { eq: userOrganizationId } },
		});
		return new Map(rows.map((row) => [row.projectId, row.role]));
	}

	test("stores a lead grant and reports it on the member", async () => {
		const res = await updateAccess({
			role: "developer",
			projectIds: [PROJECT_A, PROJECT_B],
			leadProjectIds: [PROJECT_A],
		});
		expect(res.status).toBe(200);

		const { member } = await res.json();
		expect(member.projects).toEqual(
			expect.arrayContaining([
				{ id: PROJECT_A, name: "Project A", role: "lead" },
				{ id: PROJECT_B, name: "Project B", role: "member" },
			]),
		);

		expect(await grantsFor(MEMBER_UO_ID)).toEqual(
			new Map([
				[PROJECT_A, "lead"],
				[PROJECT_B, "member"],
			]),
		);
	});

	test("defaults every grant to member when no leads are requested", async () => {
		const res = await updateAccess({
			role: "developer",
			projectIds: [PROJECT_A],
		});
		expect(res.status).toBe(200);
		expect(await grantsFor(MEMBER_UO_ID)).toEqual(
			new Map([[PROJECT_A, "member"]]),
		);
	});

	test("revokes a lead grant when it is dropped from the request", async () => {
		expect(
			(
				await updateAccess({
					role: "developer",
					projectIds: [PROJECT_A],
					leadProjectIds: [PROJECT_A],
				})
			).status,
		).toBe(200);

		expect(
			(
				await updateAccess({
					role: "developer",
					projectIds: [PROJECT_A],
					leadProjectIds: [],
				})
			).status,
		).toBe(200);

		expect(await grantsFor(MEMBER_UO_ID)).toEqual(
			new Map([[PROJECT_A, "member"]]),
		);
	});

	test("rejects leading a project the member has no access to", async () => {
		const res = await updateAccess({
			role: "developer",
			projectIds: [PROJECT_A],
			leadProjectIds: [PROJECT_B],
		});
		expect(res.status).toBe(400);
	});

	test("clears all grants when the member is promoted to admin", async () => {
		await updateAccess({
			role: "developer",
			projectIds: [PROJECT_A],
			leadProjectIds: [PROJECT_A],
		});

		const res = await updateAccess({ role: "admin" });
		expect(res.status).toBe(200);
		const { member } = await res.json();
		expect(member.projects).toBeNull();
		expect(await grantsFor(MEMBER_UO_ID)).toEqual(new Map());
	});

	test("exposes the caller's own lead grants on members/me", async () => {
		await updateAccess({
			role: "developer",
			projectIds: [PROJECT_A, PROJECT_B],
			leadProjectIds: [PROJECT_B],
		});

		// The owner leads nothing — they reach every project through their role.
		const ownerRes = await app.request(`/team/${ORG_ID}/members/me`, {
			headers: { Cookie: ownerToken },
		});
		expect(ownerRes.status).toBe(200);
		expect((await ownerRes.json()).leadProjectIds).toEqual([]);
	});
});
