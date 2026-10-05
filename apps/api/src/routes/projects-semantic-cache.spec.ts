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
			semanticCacheMode: "on",
		});
		expect(semantic.status).toBe(403);
		const shadow = await call("PATCH", `/projects/${PROJECT_ID}`, {
			cachingEnabled: true,
			semanticCacheMode: "shadow",
		});
		expect(shadow.status).toBe(403);
	});

	async function stored() {
		const [project] = await db
			.select()
			.from(tables.project)
			.where(eq(tables.project.id, PROJECT_ID));
		return project;
	}

	test("enterprise projects can enable semantic caching", async () => {
		const res = await call("PATCH", `/projects/${PROJECT_ID}`, {
			cachingEnabled: true,
			semanticCacheMode: "on",
			semanticCacheThreshold: 0.92,
		});
		expect(res.status).toBe(200);
		const project = await stored();
		expect(project.semanticCacheMode).toBe("on");
		expect(project.semanticCacheThreshold).toBeCloseTo(0.92);
	});

	test("threshold floor is 0.90", async () => {
		const low = await call("PATCH", `/projects/${PROJECT_ID}`, {
			semanticCacheThreshold: 0.85,
		});
		expect(low.status).toBe(400);
	});

	test("turning off request caching turns semantic caching off", async () => {
		await call("PATCH", `/projects/${PROJECT_ID}`, {
			cachingEnabled: true,
			semanticCacheMode: "shadow",
		});
		expect((await stored()).semanticCacheMode).toBe("shadow");
		const off = await call("PATCH", `/projects/${PROJECT_ID}`, {
			cachingEnabled: false,
		});
		expect(off.status).toBe(200);
		expect((await stored()).semanticCacheMode).toBe("off");
		const back = await call("PATCH", `/projects/${PROJECT_ID}`, {
			cachingEnabled: true,
		});
		expect(back.status).toBe(200);
		expect((await stored()).semanticCacheMode).toBe("off");
		// A mode sent alongside, or while, request caching is off never sticks.
		const armed = await call("PATCH", `/projects/${PROJECT_ID}`, {
			cachingEnabled: false,
			semanticCacheMode: "on",
		});
		expect(armed.status).toBe(200);
		expect((await stored()).semanticCacheMode).toBe("off");
		const whileOff = await call("PATCH", `/projects/${PROJECT_ID}`, {
			semanticCacheMode: "shadow",
		});
		expect(whileOff.status).toBe(200);
		expect((await stored()).semanticCacheMode).toBe("off");
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
			semanticCacheMode: "on",
		});
		expect(blocked.status).toBe(409);
		const disable = await call("PATCH", `/projects/${PROJECT_ID}`, {
			semanticCacheMode: "off",
		});
		expect(disable.status).toBe(200);
		// A project already in shadow cannot move to on under a policy either,
		// but may stay where it is or turn off.
		await db
			.update(tables.project)
			.set({ cachingEnabled: true, semanticCacheMode: "shadow" })
			.where(eq(tables.project.id, PROJECT_ID));
		const escalate = await call("PATCH", `/projects/${PROJECT_ID}`, {
			semanticCacheMode: "on",
		});
		expect(escalate.status).toBe(409);
		const same = await call("PATCH", `/projects/${PROJECT_ID}`, {
			semanticCacheMode: "shadow",
		});
		expect(same.status).toBe(200);
	});
});
