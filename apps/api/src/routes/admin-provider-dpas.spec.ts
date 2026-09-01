import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

const originalAdminEmails = process.env.ADMIN_EMAILS;
const originalEnforcementFlag = process.env.REQUIRE_PROVIDER_DPA_FOR_GDPR;

describe("admin provider DPAs", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		delete process.env.REQUIRE_PROVIDER_DPA_FOR_GDPR;
		cookie = await createTestUser();
	});

	afterEach(async () => {
		await deleteAll();
		if (originalAdminEmails === undefined) {
			delete process.env.ADMIN_EMAILS;
		} else {
			process.env.ADMIN_EMAILS = originalAdminEmails;
		}
		if (originalEnforcementFlag === undefined) {
			delete process.env.REQUIRE_PROVIDER_DPA_FOR_GDPR;
		} else {
			process.env.REQUIRE_PROVIDER_DPA_FOR_GDPR = originalEnforcementFlag;
		}
	});

	it("lists every catalogue provider with no record as unsigned", async () => {
		const res = await app.request("/admin/provider-dpas", {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);

		const json = await res.json();
		expect(json.enforcementEnabled).toBe(false);

		const openai = json.providers.find(
			(p: { providerId: string }) => p.providerId === "openai",
		);
		expect(openai).toMatchObject({
			gdpr: true,
			dpaSignedAt: null,
			dpaSignedBy: null,
		});

		// Pseudo-providers have no operator to contract with and are excluded.
		const ids = json.providers.map((p: { providerId: string }) => p.providerId);
		expect(ids).not.toContain("llmgateway");
		expect(ids).not.toContain("custom");
	});

	it("reports the enforcement flag when set", async () => {
		process.env.REQUIRE_PROVIDER_DPA_FOR_GDPR = "true";
		const res = await app.request("/admin/provider-dpas", {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		expect((await res.json()).enforcementEnabled).toBe(true);
	});

	it("marks a provider signed, defaulting signedBy to the admin", async () => {
		const res = await app.request("/admin/provider-dpas/openai", {
			method: "PUT",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ signed: true, note: "Countersigned PDF filed" }),
		});
		expect(res.status).toBe(200);

		const { provider } = await res.json();
		expect(provider.dpaSignedAt).toBeTruthy();
		expect(provider.dpaSignedBy).toBe("admin@example.com");
		expect(provider.dpaNote).toBe("Countersigned PDF filed");

		const row = await db.query.provider.findFirst({
			where: { id: { eq: "openai" } },
		});
		expect(row?.dpaSignedAt).toBeTruthy();
		expect(row?.dpaSignedBy).toBe("admin@example.com");
	});

	it("upserts a row for a provider the DB has never seen", async () => {
		await db.delete(tables.provider);

		const res = await app.request("/admin/provider-dpas/anthropic", {
			method: "PUT",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ signed: true, signedBy: "Legal Team" }),
		});
		expect(res.status).toBe(200);
		expect((await res.json()).provider.dpaSignedBy).toBe("Legal Team");
	});

	it("unmarking clears the whole record", async () => {
		await app.request("/admin/provider-dpas/openai", {
			method: "PUT",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ signed: true, note: "temp" }),
		});

		const res = await app.request("/admin/provider-dpas/openai", {
			method: "PUT",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ signed: false }),
		});
		expect(res.status).toBe(200);

		const { provider } = await res.json();
		expect(provider.dpaSignedAt).toBeNull();
		expect(provider.dpaSignedBy).toBeNull();
		expect(provider.dpaNote).toBeNull();
	});

	it("rejects unknown and pseudo providers", async () => {
		for (const id of ["no-such-provider", "llmgateway", "custom"]) {
			const res = await app.request(`/admin/provider-dpas/${id}`, {
				method: "PUT",
				headers: { Cookie: cookie, "Content-Type": "application/json" },
				body: JSON.stringify({ signed: true }),
			});
			expect(res.status, id).toBe(404);
		}
	});

	it("rejects non-admin users", async () => {
		process.env.ADMIN_EMAILS = "someone-else@example.com";
		const res = await app.request("/admin/provider-dpas", {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(403);
	});
});
