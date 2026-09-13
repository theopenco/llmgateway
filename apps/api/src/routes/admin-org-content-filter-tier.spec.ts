import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

const originalAdminEmails = process.env.ADMIN_EMAILS;

const ORG_ID = "org-content-filter-tier-test";

async function manage(
	cookie: string,
	body: Record<string, unknown>,
): Promise<Response> {
	return await app.request(`/admin/organizations/${ORG_ID}/manage`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json", Cookie: cookie },
		body: JSON.stringify({
			name: "Content Filter Tier Test",
			plan: "pro",
			seats: null,
			apiKeyLimit: null,
			projectLimit: null,
			planStartedAt: null,
			planExpiresAt: null,
			isTrialActive: false,
			trialStartDate: null,
			trialEndDate: null,
			...body,
		}),
	});
}

async function readOrg() {
	return await db.query.organization.findFirst({
		where: { id: { eq: ORG_ID } },
	});
}

describe("admin organization content filter tier", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Content Filter Tier Test",
			billingEmail: "content-filter-tier@test.example",
			plan: "pro",
		});
	});

	afterEach(async () => {
		if (originalAdminEmails === undefined) {
			delete process.env.ADMIN_EMAILS;
		} else {
			process.env.ADMIN_EMAILS = originalAdminEmails;
		}
		await deleteAll();
	});

	it("pins the content filter tier and log-only flag", async () => {
		const res = await manage(cookie, {
			contentFilterTierOverride: 3,
			contentFilterLogOnly: true,
		});

		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			contentFilterTierOverride: 3,
			contentFilterLogOnly: true,
		});
		const org = await readOrg();
		expect(org?.contentFilterTierOverride).toBe(3);
		expect(org?.contentFilterLogOnly).toBe(true);
	});

	it("leaves both fields unchanged when omitted and clears the pin on null", async () => {
		await manage(cookie, {
			contentFilterTierOverride: 2,
			contentFilterLogOnly: true,
		});

		const unchanged = await manage(cookie, {});
		expect(unchanged.status).toBe(200);
		expect(await unchanged.json()).toMatchObject({
			contentFilterTierOverride: 2,
			contentFilterLogOnly: true,
		});

		const cleared = await manage(cookie, { contentFilterTierOverride: null });
		expect(cleared.status).toBe(200);
		expect((await readOrg())?.contentFilterTierOverride).toBeNull();
	});

	it("rejects a pin outside the ladder", async () => {
		const res = await manage(cookie, { contentFilterTierOverride: 5 });
		expect(res.status).toBe(400);
		expect((await readOrg())?.contentFilterTierOverride).toBeNull();
	});

	it("reports the resolved tier on the metrics route", async () => {
		const inherited = await app.request(`/admin/organizations/${ORG_ID}`, {
			headers: { Cookie: cookie },
		});
		expect(inherited.status).toBe(200);
		expect((await inherited.json()).contentFilterTier).toEqual({
			exempt: false,
			tier: 0,
			overridden: false,
			level: "strict",
			logOnly: false,
		});

		await manage(cookie, {
			plan: "enterprise",
			contentFilterTierOverride: 4,
			contentFilterLogOnly: true,
		});
		const pinned = await app.request(`/admin/organizations/${ORG_ID}`, {
			headers: { Cookie: cookie },
		});
		expect((await pinned.json()).contentFilterTier).toEqual({
			exempt: true,
			tier: 4,
			overridden: true,
			level: "lenient",
			logOnly: true,
		});
	});

	it("exposes the raw override on the settings route", async () => {
		await manage(cookie, { contentFilterTierOverride: 1 });
		const res = await app.request(`/admin/organizations/${ORG_ID}/settings`, {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		expect((await res.json()).organization).toMatchObject({
			contentFilterTierOverride: 1,
			contentFilterLogOnly: false,
		});
	});
});
