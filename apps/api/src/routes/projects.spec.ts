import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

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

	async function createProject(name: string) {
		return await app.request("/projects", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({ name, organizationId: "test-org-id" }),
		});
	}

	test("POST /projects enforces the org project-limit override", async () => {
		// The seeded org already has one project, so a limit of 1 is reached.
		await db
			.update(tables.organization)
			.set({ projectLimit: 1 })
			.where(eq(tables.organization.id, "test-org-id"));

		const response = await createProject("Second Project");

		expect(response.status).toBe(403);
		const json = await response.json();
		expect(json.message).toContain("limit of 1 projects");
	});

	test("POST /projects allows creation below the override", async () => {
		await db
			.update(tables.organization)
			.set({ projectLimit: 2 })
			.where(eq(tables.organization.id, "test-org-id"));

		const response = await createProject("Second Project");

		expect(response.status).toBe(201);
		const json = await response.json();
		expect(json.project.name).toBe("Second Project");
	});

	test("POST /projects falls back to the plan default without an override", async () => {
		// Free plan default is 10 projects and the org has one, so this succeeds.
		const response = await createProject("Second Project");

		expect(response.status).toBe(201);
	});

	test("POST /projects rejects caching while ZDR is active", async () => {
		await db
			.update(tables.organization)
			.set({
				plan: "enterprise",
				providerCompliancePolicy: {
					enabled: true,
					zeroDataRetention: true,
				},
			})
			.where(eq(tables.organization.id, "test-org-id"));

		const response = await app.request("/projects", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				name: "Cached Project",
				organizationId: "test-org-id",
				cachingEnabled: true,
			}),
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			message: expect.stringContaining("response caching"),
		});
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

	test("PATCH /projects/{id} rejects caching while ZDR is active", async () => {
		await db
			.update(tables.organization)
			.set({
				plan: "enterprise",
				providerCompliancePolicy: {
					enabled: true,
					zeroDataRetention: true,
				},
			})
			.where(eq(tables.organization.id, "test-org-id"));

		const response = await app.request("/projects/test-project-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({ cachingEnabled: true }),
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			message: expect.stringContaining("response caching"),
		});
		expect(
			(
				await db.query.project.findFirst({
					where: { id: { eq: "test-project-id" } },
				})
			)?.cachingEnabled,
		).toBe(false);
	});

	test("PATCH /projects/{id} can disable caching while ZDR is active", async () => {
		await db
			.update(tables.organization)
			.set({
				plan: "enterprise",
				providerCompliancePolicy: {
					enabled: true,
					zeroDataRetention: true,
				},
			})
			.where(eq(tables.organization.id, "test-org-id"));
		await db
			.update(tables.project)
			.set({ cachingEnabled: true })
			.where(eq(tables.project.id, "test-project-id"));

		const response = await app.request("/projects/test-project-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({ cachingEnabled: false }),
		});

		expect(response.status).toBe(200);
		expect(
			(
				await db.query.project.findFirst({
					where: { id: { eq: "test-project-id" } },
				})
			)?.cachingEnabled,
		).toBe(false);
	});

	test("PATCH /projects/{id} rejects provider caching while ZDR is active", async () => {
		await db
			.update(tables.organization)
			.set({
				plan: "enterprise",
				providerCompliancePolicy: {
					enabled: true,
					zeroDataRetention: true,
				},
			})
			.where(eq(tables.organization.id, "test-org-id"));
		await db
			.update(tables.project)
			.set({ providerCacheControlMode: "off" })
			.where(eq(tables.project.id, "test-project-id"));

		const response = await app.request("/projects/test-project-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({ providerCacheControlMode: "auto" }),
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			message: expect.stringContaining("Provider prompt caching"),
		});
	});
});
