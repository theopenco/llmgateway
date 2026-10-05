import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

const ORG_ID = "semantic-cache-org";
const PROJECT_ID = "semantic-cache-project";

describe("semantic cache settings", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Semantic Cache Org",
			billingEmail: "semantic-cache@example.com",
			plan: "enterprise",
		});
		await db.insert(tables.userOrganization).values({
			id: `${ORG_ID}-owner`,
			userId: "test-user-id",
			organizationId: ORG_ID,
			role: "owner",
		});
		await db.insert(tables.project).values({
			id: PROJECT_ID,
			name: "Semantic Cache Project",
			organizationId: ORG_ID,
		});
	});

	afterEach(async () => {
		await deleteAll();
	});

	function call(method: string, path: string, body?: unknown) {
		return app.request(path, {
			method,
			headers: { "Content-Type": "application/json", Cookie: token },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	}

	test("semantic caching requires enterprise", async () => {
		await db
			.update(tables.organization)
			.set({ plan: "pro" })
			.where(eq(tables.organization.id, ORG_ID));
		const semantic = await call("PATCH", `/projects/${PROJECT_ID}`, {
			cachingEnabled: true,
			semanticCacheEnabled: true,
		});
		expect(semantic.status).toBe(403);
	});

	test("enterprise projects can enable semantic caching", async () => {
		const res = await call("PATCH", `/projects/${PROJECT_ID}`, {
			cachingEnabled: true,
			semanticCacheEnabled: true,
			semanticCacheThreshold: 0.9,
		});
		expect(res.status).toBe(200);
		const [project] = await db
			.select()
			.from(tables.project)
			.where(eq(tables.project.id, PROJECT_ID));
		expect(project.semanticCacheEnabled).toBe(true);
		expect(project.semanticCacheThreshold).toBeCloseTo(0.9);
	});

	test("semantic caching rules: threshold needs enterprise, policy blocks enabling", async () => {
		await db
			.update(tables.organization)
			.set({ plan: "pro" })
			.where(eq(tables.organization.id, ORG_ID));
		const threshold = await call("PATCH", `/projects/${PROJECT_ID}`, {
			semanticCacheThreshold: 0.9,
		});
		expect(threshold.status).toBe(403);
		await db
			.update(tables.organization)
			.set({
				plan: "enterprise",
				providerCompliancePolicy: { enabled: true, requireGdpr: true },
			})
			.where(eq(tables.organization.id, ORG_ID));
		const blocked = await call("PATCH", `/projects/${PROJECT_ID}`, {
			cachingEnabled: true,
			semanticCacheEnabled: true,
		});
		expect(blocked.status).toBe(409);
		const disable = await call("PATCH", `/projects/${PROJECT_ID}`, {
			semanticCacheEnabled: false,
		});
		expect(disable.status).toBe(200);
	});
});
