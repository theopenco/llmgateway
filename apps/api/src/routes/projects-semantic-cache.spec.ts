import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";
import { getApiKeyFingerprint } from "@llmgateway/shared/api-key-hash";

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

	async function stored() {
		const [project] = await db
			.select()
			.from(tables.project)
			.where(eq(tables.project.id, PROJECT_ID));
		return project;
	}

	test("semantic caching requires enterprise", async () => {
		await db
			.update(tables.organization)
			.set({ plan: "pro" })
			.where(eq(tables.organization.id, ORG_ID));
		for (const semanticCacheMode of ["on", "shadow"]) {
			const res = await call("PATCH", `/projects/${PROJECT_ID}`, {
				cachingEnabled: true,
				semanticCacheMode,
			});
			expect(res.status).toBe(403);
		}
		expect((await stored()).semanticCacheMode).toBe("off");
	});

	test("enterprise projects can enable semantic caching under a compliance policy", async () => {
		await db
			.update(tables.organization)
			.set({ providerCompliancePolicy: { enabled: true, requireGdpr: true } })
			.where(eq(tables.organization.id, ORG_ID));
		const res = await call("PATCH", `/projects/${PROJECT_ID}`, {
			cachingEnabled: true,
			semanticCacheMode: "on",
		});
		expect(res.status).toBe(200);
		expect((await stored()).semanticCacheMode).toBe("on");
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

	test("turning off request caching with a master key turns semantic caching off", async () => {
		const masterToken = `mk-${crypto.randomUUID()}`;
		await db.insert(tables.masterKey).values({
			id: "semantic-cache-master-key",
			tokenHash: getApiKeyFingerprint(masterToken),
			maskedToken: "mk-****",
			description: "Semantic Cache Master Key",
			status: "active",
			organizationId: ORG_ID,
			createdBy: "test-user-id",
		});
		await db
			.update(tables.project)
			.set({ cachingEnabled: true, semanticCacheMode: "on" })
			.where(eq(tables.project.id, PROJECT_ID));

		const res = await app.request(`/v1/master/projects/${PROJECT_ID}`, {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${masterToken}`,
			},
			body: JSON.stringify({ cachingEnabled: false }),
		});
		expect(res.status).toBe(200);
		const project = await stored();
		expect(project.cachingEnabled).toBe(false);
		expect(project.semanticCacheMode).toBe("off");
	});
});
