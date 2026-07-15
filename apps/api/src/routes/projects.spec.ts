import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

describe("projects route", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();

		await db.insert(tables.organization).values({
			id: "test-org-id",
			name: "Test Organization",
			billingEmail: "test@example.com",
		});

		await db.insert(tables.userOrganization).values({
			userId: "test-user-id",
			organizationId: "test-org-id",
			role: "owner",
		});

		await db.insert(tables.project).values({
			id: "test-project-id",
			name: "Test Project",
			organizationId: "test-org-id",
		});
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("PATCH /projects/{id} with an empty body is a no-op", async () => {
		const response = await app.request("/projects/test-project-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({}),
		});

		expect(response.status).toBe(200);

		const json = await response.json();
		expect(json.project.id).toBe("test-project-id");
		expect(json.project.name).toBe("Test Project");
	});

	test("PATCH /projects/{id} updates provided fields", async () => {
		const response = await app.request("/projects/test-project-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({ name: "Renamed Project" }),
		});

		expect(response.status).toBe(200);

		const json = await response.json();
		expect(json.project.name).toBe("Renamed Project");

		const project = await db.query.project.findFirst({
			where: {
				id: {
					eq: "test-project-id",
				},
			},
		});
		expect(project?.name).toBe("Renamed Project");
	});
});
