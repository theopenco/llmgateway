import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { cdb, db, eq, tables } from "@llmgateway/db";

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
	describe("auto routing configuration", () => {
		async function patchSmartRouting(body: unknown) {
			return await app.request("/projects/test-project-id", {
				method: "PATCH",
				headers: {
					"Content-Type": "application/json",
					Cookie: token,
				},
				body: JSON.stringify({ smartRoutingConfig: body }),
			});
		}

		async function storedConfig() {
			return (
				await db.query.project.findFirst({
					where: { id: { eq: "test-project-id" } },
				})
			)?.smartRoutingConfig;
		}

		beforeEach(async () => {
			await db
				.update(tables.organization)
				.set({ plan: "enterprise" })
				.where(eq(tables.organization.id, "test-org-id"));
		});

		test("stores an override and clears it with null", async () => {
			expect(
				(
					await patchSmartRouting({
						classifier: "jev",
						models: ["gpt-4o-mini", "gpt-4o"],
					})
				).status,
			).toBe(200);
			expect(await storedConfig()).toEqual({
				classifier: "jev",
				models: ["gpt-4o-mini", "gpt-4o"],
			});

			expect((await patchSmartRouting(null)).status).toBe(200);
			expect(await storedConfig()).toBeNull();
		});

		test("stores a fallback model only when it is one of the configured models", async () => {
			expect(
				(
					await patchSmartRouting({
						classifier: "jev",
						models: ["gpt-4o-mini", "gpt-4o"],
						fallbackModel: "gpt-4o",
					})
				).status,
			).toBe(200);
			expect(await storedConfig()).toEqual({
				classifier: "jev",
				models: ["gpt-4o-mini", "gpt-4o"],
				fallbackModel: "gpt-4o",
			});

			expect(
				(
					await patchSmartRouting({
						classifier: "jev",
						models: ["gpt-4o-mini"],
						fallbackModel: "gpt-4o",
					})
				).status,
			).toBe(400);
		});

		test("rejects unknown models and oversized lists", async () => {
			expect(
				(await patchSmartRouting({ classifier: "none", models: ["nope-9000"] }))
					.status,
			).toBe(400);
			expect(
				(
					await patchSmartRouting({
						classifier: "none",
						models: Array.from({ length: 31 }, () => "gpt-4o-mini"),
					})
				).status,
			).toBe(400);
		});

		test("rejects DevPass organizations, but still lets them clear", async () => {
			await cdb
				.update(tables.organization)
				.set({ kind: "devpass" })
				.where(eq(tables.organization.id, "test-org-id"));
			await db
				.update(tables.project)
				.set({
					smartRoutingConfig: { classifier: "none", models: ["gpt-4o-mini"] },
				})
				.where(eq(tables.project.id, "test-project-id"));

			expect(
				(await patchSmartRouting({ classifier: "none", models: ["gpt-4o"] }))
					.status,
			).toBe(403);
			expect((await patchSmartRouting(null)).status).toBe(200);
			expect(await storedConfig()).toBeNull();
		});

		test("rejects a member who cannot manage the project", async () => {
			await db
				.update(tables.userOrganization)
				.set({ role: "developer" })
				.where(eq(tables.userOrganization.organizationId, "test-org-id"));

			expect(
				(
					await patchSmartRouting({
						classifier: "none",
						models: ["gpt-4o-mini"],
					})
				).status,
			).not.toBe(200);
		});
	});
});
