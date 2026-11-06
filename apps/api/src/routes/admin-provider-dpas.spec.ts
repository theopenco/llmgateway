import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables, cdb, eq } from "@llmgateway/db";

const originalAdminEmails = process.env.ADMIN_FULL_ACCESS_EMAILS;
const originalEnforcementFlag = process.env.REQUIRE_PROVIDER_DPA_FOR_GDPR;

describe("admin provider DPAs", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "admin@example.com";
		delete process.env.REQUIRE_PROVIDER_DPA_FOR_GDPR;
		cookie = await createTestUser();
	});

	afterEach(async () => {
		await deleteAll();
		if (originalAdminEmails === undefined) {
			delete process.env.ADMIN_FULL_ACCESS_EMAILS;
		} else {
			process.env.ADMIN_FULL_ACCESS_EMAILS = originalAdminEmails;
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

	it("supports signed records for active Airside carriers", async () => {
		await db
			.insert(tables.providerCompany)
			.values({ id: "dpa-company", name: "Test Company" });
		await cdb.insert(tables.providerClaim).values({
			providerCompanyId: "dpa-company",
			providerId: "test-dpa-carrier",
			kind: "custom",
			status: "active",
			matchedDomain: "example.com",
			customName: "Test Carrier",
			customBaseUrl: "https://example.com/v1",
			gdpr: true,
		});
		const response = await app.request(
			"/admin/provider-dpas/test-dpa-carrier",
			{
				method: "PUT",
				headers: { Cookie: cookie, "Content-Type": "application/json" },
				body: JSON.stringify({ signed: true }),
			},
		);
		expect(response.status).toBe(200);
		const listing = await app.request("/admin/provider-dpas", {
			headers: { Cookie: cookie },
		});
		expect(
			(await listing.json()).providers.find(
				(row: { providerId: string }) => row.providerId === "test-dpa-carrier",
			),
		).toMatchObject({ gdpr: true, dpaSignedBy: "admin@example.com" });
	});

	it("rejects non-admin users", async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "someone-else@example.com";
		const res = await app.request("/admin/provider-dpas", {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(403);
	});
});
describe("public Airside training posture", () => {
	beforeEach(async () => {
		await deleteAll();
	});
	afterEach(async () => {
		await deleteAll();
	});
	it("warns on a DB-only carrier that declares training on prompts", async () => {
		await db.insert(tables.provider).values({
			id: "training-test-carrier",
			name: "Test Carrier",
			description: "Synthetic carrier",
		});
		await db
			.insert(tables.providerCompany)
			.values({ id: "training-test-company", name: "Test Company" });
		await cdb.insert(tables.providerClaim).values({
			providerCompanyId: "training-test-company",
			providerId: "training-test-carrier",
			kind: "custom",
			status: "active",
			matchedDomain: "example.com",
			customName: "Test Carrier",
			customBaseUrl: "https://example.com/v1",
			apiTraining: true,
		});
		const response = await app.request("/internal/providers");
		expect(response.status).toBe(200);
		expect(
			(await response.json()).providers.find(
				(row: { id: string }) => row.id === "training-test-carrier",
			),
		).toMatchObject({ apiTraining: true });
	});
});
describe("public provider projection", () => {
	beforeEach(async () => {
		await deleteAll();
	});
	afterEach(async () => {
		await db
			.update(tables.provider)
			.set({ dpaSignedAt: null, dpaSignedBy: null, dpaNote: null })
			.where(eq(tables.provider.id, "openai"));
		await deleteAll();
	});
	it("does not disclose agreement metadata on the anonymous catalogue endpoint", async () => {
		await db
			.insert(tables.provider)
			.values({
				id: "openai",
				name: "OpenAI",
				description: "Test provider",
				dpaSignedAt: new Date(),
				dpaSignedBy: "admin@example.com",
				dpaNote: "synthetic-private-agreement-note",
			})
			.onConflictDoUpdate({
				target: tables.provider.id,
				set: {
					dpaSignedAt: new Date(),
					dpaSignedBy: "admin@example.com",
					dpaNote: "synthetic-private-agreement-note",
				},
			});
		const response = await app.request("/internal/providers");
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(
			JSON.stringify(body).includes("synthetic-private-agreement-note"),
		).toBe(false);
		expect(
			body.providers.find((row: { id: string }) => row.id === "openai"),
		).not.toHaveProperty("dpaSignedBy");
		expect(
			body.providers.find((row: { id: string }) => row.id === "openai"),
		).not.toHaveProperty("dpaNote");
		expect(
			body.providers.find((row: { id: string }) => row.id === "openai"),
		).not.toHaveProperty("dpaSignedAt");
	});
});
