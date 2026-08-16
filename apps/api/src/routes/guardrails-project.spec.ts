import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

describe("project guardrails API", () => {
	let token: string;

	afterEach(async () => {
		await deleteAll();
	});

	beforeEach(async () => {
		token = await createTestUser();

		await db.insert(tables.organization).values({
			id: "test-org-id",
			name: "Test Organization",
			billingEmail: "test@example.com",
			plan: "enterprise",
		});

		await db.insert(tables.userOrganization).values({
			id: "test-user-org-id",
			userId: "test-user-id",
			organizationId: "test-org-id",
		});

		await db.insert(tables.project).values([
			{
				id: "test-project-id",
				name: "Test Project",
				organizationId: "test-org-id",
			},
			{
				id: "other-project-id",
				name: "Other Project",
				organizationId: "test-org-id",
			},
		]);
	});

	function authed(path: string, init: RequestInit = {}) {
		return app.request(path, {
			...init,
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
		});
	}

	test("requires authentication", async () => {
		const res = await app.request(
			"/guardrails/projects/test-project-id/config",
		);
		expect(res.status).toBe(401);
	});

	test("developers cannot manage project guardrails", async () => {
		await db
			.update(tables.userOrganization)
			.set({ role: "developer" })
			.where(eq(tables.userOrganization.id, "test-user-org-id"));

		const res = await authed("/guardrails/projects/test-project-id/config");
		expect(res.status).toBe(403);
	});

	test("non-enterprise organizations are rejected", async () => {
		await db
			.update(tables.organization)
			.set({ plan: "pro" })
			.where(eq(tables.organization.id, "test-org-id"));

		const res = await authed("/guardrails/projects/test-project-id/config");
		expect(res.status).toBe(403);
	});

	test("rejects a project outside the user's organizations", async () => {
		await db.insert(tables.organization).values({
			id: "foreign-org-id",
			name: "Foreign Organization",
			billingEmail: "foreign@example.com",
			plan: "enterprise",
		});
		await db.insert(tables.project).values({
			id: "foreign-project-id",
			name: "Foreign Project",
			organizationId: "foreign-org-id",
		});

		const res = await authed("/guardrails/projects/foreign-project-id/config");
		expect(res.status).toBe(403);
	});

	test("project config starts empty and defaults to inheriting", async () => {
		const res = await authed("/guardrails/projects/test-project-id/config");
		expect(res.status).toBe(200);
		expect(await res.json()).toBeNull();

		const saved = await authed("/guardrails/projects/test-project-id/config", {
			method: "PUT",
			body: JSON.stringify({ enabled: true }),
		});
		expect(saved.status).toBe(200);

		const body = await saved.json();
		expect(body.projectId).toBe("test-project-id");
		expect(body.organizationId).toBe("test-org-id");
		expect(body.inheritOrganization).toBe(true);
	});

	test("organization and project configs are stored separately", async () => {
		await authed("/guardrails/config/test-org-id", {
			method: "PUT",
			body: JSON.stringify({ enabled: true, maxFileSizeMb: 25 }),
		});
		await authed("/guardrails/projects/test-project-id/config", {
			method: "PUT",
			body: JSON.stringify({
				inheritOrganization: false,
				enabled: true,
				maxFileSizeMb: 5,
			}),
		});

		const orgConfig = await (
			await authed("/guardrails/config/test-org-id")
		).json();
		expect(orgConfig.projectId).toBeNull();
		expect(orgConfig.maxFileSizeMb).toBe(25);

		const projectConfig = await (
			await authed("/guardrails/projects/test-project-id/config")
		).json();
		expect(projectConfig.maxFileSizeMb).toBe(5);
		expect(projectConfig.inheritOrganization).toBe(false);
	});

	test("rules are scoped to the level they were created on", async () => {
		const orgRule = await (
			await authed("/guardrails/rules/test-org-id", {
				method: "POST",
				body: JSON.stringify({
					name: "Org rule",
					type: "blocked_terms",
					config: {
						type: "blocked_terms",
						terms: ["org"],
						matchType: "contains",
						caseSensitive: false,
					},
				}),
			})
		).json();
		expect(orgRule.projectId).toBeNull();

		const projectRule = await (
			await authed("/guardrails/projects/test-project-id/rules", {
				method: "POST",
				body: JSON.stringify({
					name: "Project rule",
					type: "blocked_terms",
					config: {
						type: "blocked_terms",
						terms: ["project"],
						matchType: "contains",
						caseSensitive: false,
					},
				}),
			})
		).json();
		expect(projectRule.projectId).toBe("test-project-id");

		const orgRules = await (
			await authed("/guardrails/rules/test-org-id")
		).json();
		expect(orgRules.rules.map((r: { name: string }) => r.name)).toEqual([
			"Org rule",
		]);

		const projectRules = await (
			await authed("/guardrails/projects/test-project-id/rules")
		).json();
		expect(projectRules.rules.map((r: { name: string }) => r.name)).toEqual([
			"Project rule",
		]);

		// A project route must not reach an organization rule, nor another
		// project's rule.
		const crossScope = await authed(
			`/guardrails/projects/test-project-id/rules/${orgRule.id}`,
			{ method: "DELETE" },
		);
		expect(crossScope.status).toBe(404);

		const otherProject = await authed(
			`/guardrails/projects/other-project-id/rules/${projectRule.id}`,
			{ method: "PATCH", body: JSON.stringify({ enabled: false }) },
		);
		expect(otherProject.status).toBe(404);

		const orgRouteOnProjectRule = await authed(
			`/guardrails/rules/test-org-id/${projectRule.id}`,
			{ method: "DELETE" },
		);
		expect(orgRouteOnProjectRule.status).toBe(404);
	});

	test("project overrides are listed for the organization", async () => {
		const empty = await (
			await authed("/guardrails/config/test-org-id/project-overrides")
		).json();
		expect(empty.projects).toEqual([]);

		await authed("/guardrails/projects/test-project-id/config", {
			method: "PUT",
			body: JSON.stringify({ inheritOrganization: true, enabled: true }),
		});

		const stillInheriting = await (
			await authed("/guardrails/config/test-org-id/project-overrides")
		).json();
		expect(stillInheriting.projects).toEqual([]);

		await authed("/guardrails/projects/test-project-id/config", {
			method: "PUT",
			body: JSON.stringify({ inheritOrganization: false }),
		});

		const overrides = await (
			await authed("/guardrails/config/test-org-id/project-overrides")
		).json();
		expect(overrides.projects).toEqual([
			{ id: "test-project-id", name: "Test Project", enabled: true },
		]);
	});

	test("resetting a project config keeps it project-scoped", async () => {
		await authed("/guardrails/projects/test-project-id/config", {
			method: "PUT",
			body: JSON.stringify({ inheritOrganization: false, maxFileSizeMb: 99 }),
		});

		const reset = await (
			await authed("/guardrails/projects/test-project-id/config/reset", {
				method: "POST",
			})
		).json();

		expect(reset.projectId).toBe("test-project-id");
		expect(reset.inheritOrganization).toBe(true);
		expect(reset.maxFileSizeMb).toBe(10);
	});

	test("resetting keeps exactly one config row for the scope", async () => {
		await authed("/guardrails/config/test-org-id", {
			method: "PUT",
			body: JSON.stringify({ maxFileSizeMb: 42 }),
		});

		const before = await db.query.guardrailConfig.findFirst({
			where: { organizationId: { eq: "test-org-id" } },
		});

		await authed("/guardrails/config/test-org-id/reset", { method: "POST" });

		// Reset updates in place, so the scope is never left without a config and
		// the row keeps its identity.
		const rows = await db.query.guardrailConfig.findMany({
			where: { organizationId: { eq: "test-org-id" } },
		});
		expect(rows).toHaveLength(1);
		expect(rows[0].id).toBe(before!.id);
		expect(rows[0].maxFileSizeMb).toBe(10);
	});
});
