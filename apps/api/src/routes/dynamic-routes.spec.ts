import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

import type { DynamicRouteGraph } from "@llmgateway/shared/dynamic-route";

const VALID_GRAPH: DynamicRouteGraph = {
	entry: "split",
	nodes: [
		{
			id: "split",
			type: "percentage",
			splits: [
				{ weight: 90, next: "main" },
				{ weight: 10, next: "experiment" },
			],
		},
		{ id: "main", type: "model", model: "gpt-4o-mini" },
		{ id: "experiment", type: "model", model: "gpt-5-nano" },
	],
} as DynamicRouteGraph;

const SECOND_GRAPH: DynamicRouteGraph = {
	entry: "m",
	nodes: [{ id: "m", type: "model", model: "gpt-4o-mini" }],
} as DynamicRouteGraph;

describe("dynamic routes API", () => {
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

		await db.insert(tables.project).values({
			id: "test-project-id",
			name: "Test Project",
			organizationId: "test-org-id",
		});
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

	async function createRoute(name = "support", graph: unknown = VALID_GRAPH) {
		return await authed("/dynamic-routes/test-project-id", {
			method: "POST",
			body: JSON.stringify({ name, graph }),
		});
	}

	test("requires authentication", async () => {
		const res = await app.request("/dynamic-routes/test-project-id");
		expect(res.status).toBe(401);
	});

	test("requires an enterprise plan", async () => {
		// Recreate the org on the pro plan; every endpoint must reject it.
		await deleteAll();
		token = await createTestUser();
		await db.insert(tables.organization).values({
			id: "test-org-id",
			name: "Test Organization",
			billingEmail: "test@example.com",
			plan: "pro",
		});
		await db.insert(tables.userOrganization).values({
			id: "test-user-org-id",
			userId: "test-user-id",
			organizationId: "test-org-id",
		});
		await db.insert(tables.project).values({
			id: "test-project-id",
			name: "Test Project",
			organizationId: "test-org-id",
		});

		const res = await authed("/dynamic-routes/test-project-id");
		expect(res.status).toBe(403);
	});

	test("create, list, and get a route", async () => {
		const created = await createRoute();
		expect(created.status).toBe(201);
		const createdJson = await created.json();
		expect(createdJson.name).toBe("support");
		expect(createdJson.publishedVersion).toBeNull();
		expect(createdJson.draftGraph.entry).toBe("split");

		const list = await authed("/dynamic-routes/test-project-id");
		expect(list.status).toBe(200);
		const listJson = await list.json();
		expect(listJson.routes).toHaveLength(1);
		expect(listJson.routes[0]).toMatchObject({
			name: "support",
			enabled: true,
			hasDraft: true,
			publishedVersion: null,
		});

		const detail = await authed("/dynamic-routes/test-project-id/support");
		expect(detail.status).toBe(200);
		expect((await detail.json()).name).toBe("support");
	});

	test("rejects invalid graphs and invalid names on create", async () => {
		const unknownModel = await createRoute("bad-model", {
			entry: "m",
			nodes: [{ id: "m", type: "model", model: "not-a-real-model" }],
		});
		expect(unknownModel.status).toBe(400);

		const cyclic = await createRoute("cyclic", {
			entry: "a",
			nodes: [
				{
					id: "a",
					type: "conditional",
					conditions: [
						{
							field: { source: "header", path: "x" },
							op: "exists",
							next: "b",
						},
					],
					else: "b",
				},
				{
					id: "b",
					type: "conditional",
					conditions: [
						{
							field: { source: "header", path: "y" },
							op: "exists",
							next: "a",
						},
					],
					else: "a",
				},
			],
		});
		expect(cyclic.status).toBe(400);

		const badName = await createRoute("Bad_Name");
		expect(badName.status).toBe(400);
	});

	test("creates and publishes routes with organization custom models", async () => {
		await db.insert(tables.providerKey).values({
			id: "custom-provider-key",
			token: "custom-provider-token",
			provider: "custom",
			name: "private-provider",
			baseUrl: "https://example.com/v1",
			organizationId: "test-org-id",
		});
		await db.insert(tables.customModel).values({
			id: "custom-model-id",
			providerKeyId: "custom-provider-key",
			organizationId: "test-org-id",
			modelName: "private-model",
		});

		const graph = {
			entry: "m",
			nodes: [
				{
					id: "m",
					type: "model",
					model: "private-provider/private-model",
				},
			],
		};
		const created = await createRoute("custom-route", graph);
		expect(created.status).toBe(201);

		const published = await authed(
			"/dynamic-routes/test-project-id/custom-route/publish",
			{ method: "POST" },
		);
		expect(published.status).toBe(200);
		expect((await published.json()).publishedVersion.graph).toEqual(graph);

		const missing = await createRoute("missing-custom", {
			entry: "m",
			nodes: [
				{
					id: "m",
					type: "model",
					model: "private-provider/missing-model",
				},
			],
		});
		expect(missing.status).toBe(400);

		await db
			.update(tables.customModel)
			.set({ status: "inactive" })
			.where(eq(tables.customModel.id, "custom-model-id"));
		const inactiveModel = await createRoute("inactive-custom-model", graph);
		expect(inactiveModel.status).toBe(400);

		await db
			.update(tables.customModel)
			.set({ status: "active" })
			.where(eq(tables.customModel.id, "custom-model-id"));
		await db
			.update(tables.providerKey)
			.set({ status: "inactive" })
			.where(eq(tables.providerKey.id, "custom-provider-key"));
		const inactiveProvider = await createRoute(
			"inactive-custom-provider",
			graph,
		);
		expect(inactiveProvider.status).toBe(400);
	});

	test("duplicate names conflict with 409", async () => {
		expect((await createRoute()).status).toBe(201);
		expect((await createRoute()).status).toBe(409);
	});

	test("draft, publish, republish, and rollback lifecycle", async () => {
		expect((await createRoute()).status).toBe(201);

		// v1
		const publish1 = await authed(
			"/dynamic-routes/test-project-id/support/publish",
			{ method: "POST" },
		);
		expect(publish1.status).toBe(200);
		const published1 = await publish1.json();
		expect(published1.publishedVersion.version).toBe(1);

		// new draft + v2
		const draft = await authed(
			"/dynamic-routes/test-project-id/support/draft",
			{ method: "PUT", body: JSON.stringify({ graph: SECOND_GRAPH }) },
		);
		expect(draft.status).toBe(200);
		const publish2 = await authed(
			"/dynamic-routes/test-project-id/support/publish",
			{ method: "POST" },
		);
		expect(publish2.status).toBe(200);
		const published2 = await publish2.json();
		expect(published2.publishedVersion.version).toBe(2);
		expect(published2.publishedVersion.graph.entry).toBe("m");

		// versions list marks v2 as published
		const versions = await authed(
			"/dynamic-routes/test-project-id/support/versions",
		);
		const versionsJson = await versions.json();
		expect(versionsJson.versions).toHaveLength(2);
		expect(versionsJson.versions[0]).toMatchObject({
			version: 2,
			published: true,
		});
		expect(versionsJson.versions[1]).toMatchObject({
			version: 1,
			published: false,
		});

		// rollback to v1
		const v1Id = versionsJson.versions[1].id;
		const rollback = await authed(
			"/dynamic-routes/test-project-id/support/rollback",
			{ method: "POST", body: JSON.stringify({ versionId: v1Id }) },
		);
		expect(rollback.status).toBe(200);
		expect((await rollback.json()).publishedVersion.version).toBe(1);

		// rollback to an unknown version id 404s
		const badRollback = await authed(
			"/dynamic-routes/test-project-id/support/rollback",
			{ method: "POST", body: JSON.stringify({ versionId: "nope" }) },
		);
		expect(badRollback.status).toBe(404);
	});

	test("rejects an invalid draft graph on save", async () => {
		expect((await createRoute()).status).toBe(201);
		const res = await authed("/dynamic-routes/test-project-id/support/draft", {
			method: "PUT",
			body: JSON.stringify({
				graph: {
					entry: "m",
					nodes: [{ id: "m", type: "model", model: "not-a-real-model" }],
				},
			}),
		});
		expect(res.status).toBe(400);
	});

	test("publishing without a draft fails with 400", async () => {
		const created = await authed("/dynamic-routes/test-project-id", {
			method: "POST",
			body: JSON.stringify({ name: "empty" }),
		});
		expect(created.status).toBe(201);
		const publish = await authed(
			"/dynamic-routes/test-project-id/empty/publish",
			{ method: "POST" },
		);
		expect(publish.status).toBe(400);
	});

	test("toggle enabled and delete", async () => {
		expect((await createRoute()).status).toBe(201);

		const patched = await authed("/dynamic-routes/test-project-id/support", {
			method: "PATCH",
			body: JSON.stringify({ enabled: false }),
		});
		expect(patched.status).toBe(200);
		expect((await patched.json()).enabled).toBe(false);

		const deleted = await authed("/dynamic-routes/test-project-id/support", {
			method: "DELETE",
		});
		expect(deleted.status).toBe(200);

		const gone = await authed("/dynamic-routes/test-project-id/support");
		expect(gone.status).toBe(404);
	});
});
