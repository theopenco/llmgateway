import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

const ORG_ID = "admin-provider-access-org";
const PATH = `/admin/organizations/${ORG_ID}/provider-access`;

describe("admin provider access restriction", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "admin@example.com";
		delete process.env.ADMIN_VIEWER_EMAILS;
		cookie = await createTestUser();
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Admin Provider Access Org",
			billingEmail: "admin-provider-access@example.com",
		});
	});

	afterEach(async () => {
		await deleteAll();
	});

	function put(restriction: unknown) {
		return app.request(PATH, {
			method: "PUT",
			headers: { "Content-Type": "application/json", Cookie: cookie },
			body: JSON.stringify({ restriction }),
		});
	}

	async function stored() {
		const [row] = await db
			.select({
				restriction: tables.organization.providerAccessRestriction,
			})
			.from(tables.organization)
			.where(eq(tables.organization.id, ORG_ID));
		return row?.restriction ?? null;
	}

	test("defaults to no restriction and lists catalogue options", async () => {
		const res = await app.request(PATH, { headers: { Cookie: cookie } });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.restriction).toBeNull();
		expect(
			body.options.providers.some((p: { id: string }) => p.id === "openai"),
		).toBe(true);
		expect(
			body.options.mappings.some(
				(m: { providerId: string; modelId: string }) =>
					m.providerId === "openai" && m.modelId === "gpt-4o-mini",
			),
		).toBe(true);
	});

	test("saves a normalized restriction, audits it, and clears it", async () => {
		const res = await put({
			mode: "deny",
			providers: ["openai", "openai"],
			models: ["gpt-4o-mini"],
			mappings: ["anthropic/claude-haiku-4-5"],
			note: "Customer request",
		});
		expect(res.status).toBe(200);
		expect(await stored()).toEqual({
			mode: "deny",
			providers: ["openai"],
			models: ["gpt-4o-mini"],
			mappings: ["anthropic/claude-haiku-4-5"],
			note: "Customer request",
		});

		const cleared = await put(null);
		expect(cleared.status).toBe(200);
		expect(await stored()).toBeNull();

		const audits = await db.query.auditLog.findMany({
			where: {
				organizationId: ORG_ID,
				action: "organization.provider_access_update",
			},
		});
		expect(audits).toHaveLength(2);
		// Org owners can read the audit log; the staff-only note must stay out.
		expect(JSON.stringify(audits)).not.toContain("Customer request");
	});

	test("rejects unknown entries and empty restrictions", async () => {
		const unknown = await put({
			mode: "allow",
			providers: ["not-a-provider"],
			models: [],
			mappings: ["openai/not-a-model"],
		});
		expect(unknown.status).toBe(400);
		const message = (await unknown.json()).message;
		expect(message).toContain("not-a-provider");
		expect(message).toContain("openai/not-a-model");

		const empty = await put({
			mode: "allow",
			providers: [],
			models: [],
			mappings: [],
		});
		expect(empty.status).toBe(400);
		expect(await stored()).toBeNull();
	});

	test("viewers can read but not change the restriction", async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "";
		process.env.ADMIN_VIEWER_EMAILS = "admin@example.com";

		expect(
			(await app.request(PATH, { headers: { Cookie: cookie } })).status,
		).toBe(200);
		const res = await put({
			mode: "deny",
			providers: ["openai"],
			models: [],
			mappings: [],
		});
		expect(res.status).toBe(403);
		expect(await stored()).toBeNull();
	});
});
