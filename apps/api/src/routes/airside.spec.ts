import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

const originalAdminEmails = process.env.ADMIN_EMAILS;
const originalListingPriceId = process.env.AIRSIDE_LISTING_PRICE_ID;

async function setUserEmail(email: string) {
	await db
		.update(tables.user)
		.set({ email })
		.where(eq(tables.user.id, "test-user-id"));
}

function json(cookie: string, body?: unknown, method = "POST") {
	return {
		method,
		headers: { Cookie: cookie, "Content-Type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	};
}

async function createCompany(cookie: string, name = "Mistral Ops") {
	const res = await app.request(
		"/airside/companies",
		json(cookie, { name, website: "https://mistral.ai" }),
	);
	expect(res.status).toBe(201);
	const body = await res.json();
	return body.company as { id: string };
}

async function claimProvider(
	cookie: string,
	providerCompanyId: string,
	providerId = "mistral",
) {
	const res = await app.request(
		"/airside/claims",
		json(cookie, { providerCompanyId, providerId }),
	);
	expect(res.status).toBe(201);
	return (await res.json()).claim as {
		id: string;
		providerId: string;
		status: string;
	};
}

// Fast-path activation for tests that aren't about the review flow itself —
// the admin approval endpoints get their own lifecycle test below.
async function activateClaim(providerId = "mistral") {
	await db
		.update(tables.providerClaim)
		.set({ status: "active" })
		.where(eq(tables.providerClaim.providerId, providerId));
}

async function createModel(
	cookie: string,
	providerCompanyId: string,
	overrides: Record<string, unknown> = {},
) {
	const res = await app.request(
		"/airside/models",
		json(cookie, {
			providerCompanyId,
			providerId: "mistral",
			modelName: "mistral-large-3",
			displayName: "Mistral Large 3",
			contextSize: 256000,
			streaming: true,
			tools: true,
			pricing: { inputPrice: "2e-6", outputPrice: "6e-6" },
			...overrides,
		}),
	);
	return res;
}

describe("airside provider portal", () => {
	let cookie: string;

	beforeEach(async () => {
		cookie = await createTestUser();
	});

	afterEach(async () => {
		if (originalAdminEmails === undefined) {
			delete process.env.ADMIN_EMAILS;
		} else {
			process.env.ADMIN_EMAILS = originalAdminEmails;
		}
		if (originalListingPriceId === undefined) {
			delete process.env.AIRSIDE_LISTING_PRICE_ID;
		} else {
			process.env.AIRSIDE_LISTING_PRICE_ID = originalListingPriceId;
		}
		await db.delete(tables.modelProviderMapping);
		await db.delete(tables.model);
		await db.delete(tables.provider);
		await deleteAll();
	});

	it("rejects unauthenticated requests", async () => {
		expect((await app.request("/airside/companies")).status).toBe(401);
	});

	it("creates and lists provider companies", async () => {
		const company = await createCompany(cookie);
		const res = await app.request("/airside/companies", {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.companies).toHaveLength(1);
		expect(body.companies[0]).toMatchObject({
			id: company.id,
			name: "Mistral Ops",
			role: "owner",
			claims: [],
		});
	});

	it("requires a verified email for company creation", async () => {
		await db
			.update(tables.user)
			.set({ emailVerified: false })
			.where(eq(tables.user.id, "test-user-id"));
		const res = await app.request(
			"/airside/companies",
			json(cookie, { name: "Unverified Inc" }),
		);
		expect(res.status).toBe(403);
	});

	it("lists claimable providers matched by email domain", async () => {
		// admin@example.com matches no catalogue provider.
		const none = await app.request("/airside/claimable", {
			headers: { Cookie: cookie },
		});
		expect((await none.json()).providers).toEqual([]);

		await setUserEmail("ops@mistral.ai");
		const res = await app.request("/airside/claimable", {
			headers: { Cookie: cookie },
		});
		const body = await res.json();
		expect(body.emailDomain).toBe("mistral.ai");
		expect(body.providers).toEqual([
			expect.objectContaining({
				providerId: "mistral",
				claimed: false,
				claimedByMyCompany: false,
				myClaimStatus: null,
			}),
		]);
	});

	it("claims a provider only on a domain match and only once", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);

		const wrongProvider = await app.request(
			"/airside/claims",
			json(cookie, { providerCompanyId: company.id, providerId: "deepseek" }),
		);
		expect(wrongProvider.status).toBe(403);

		const claim = await claimProvider(cookie, company.id);
		expect(claim.providerId).toBe("mistral");
		// Claims land pending: carriers only go live once we approve them.
		expect(claim.status).toBe("pending");

		// A company can hold several providers, but a provider only one live
		// claim — even while the first one is still under review.
		const secondCompany = await createCompany(cookie, "Mistral EU");
		const duplicate = await app.request(
			"/airside/claims",
			json(cookie, {
				providerCompanyId: secondCompany.id,
				providerId: "mistral",
			}),
		);
		expect(duplicate.status).toBe(409);

		// The claim shows up on /claimable as under review by my company.
		const claimable = await app.request("/airside/claimable", {
			headers: { Cookie: cookie },
		});
		expect((await claimable.json()).providers[0]).toMatchObject({
			claimed: true,
			claimedByMyCompany: true,
			myClaimStatus: "pending",
		});
	});

	it("blocks model listing until the claim is approved", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		const res = await createModel(cookie, company.id);
		expect(res.status).toBe(403);
		expect((await res.json()).message).toContain("under review");

		await activateClaim();
		const approved = await createModel(cookie, company.id);
		expect(approved.status).toBe(201);
	});

	it("runs the claim review lifecycle through the admin queue", async () => {
		process.env.ADMIN_EMAILS = "ops@mistral.ai";
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		const claim = await claimProvider(cookie, company.id);

		const queue = await app.request("/admin/airside/claims?status=pending", {
			headers: { Cookie: cookie },
		});
		expect(queue.status).toBe(200);
		const queueBody = await queue.json();
		expect(queueBody.pendingCount).toBe(1);
		expect(queueBody.claims[0]).toMatchObject({
			id: claim.id,
			providerId: "mistral",
			matchedDomain: "mistral.ai",
			claimedByEmail: "ops@mistral.ai",
			company: expect.objectContaining({ name: "Mistral Ops" }),
		});

		// Reject → the provider becomes claimable again.
		const rejected = await app.request(
			`/admin/airside/claims/${claim.id}/reject`,
			json(cookie, { reviewNote: "Cannot verify the company" }),
		);
		expect(rejected.status).toBe(200);
		expect((await rejected.json()).claim.status).toBe("rejected");

		const reclaimable = await app.request("/airside/claimable", {
			headers: { Cookie: cookie },
		});
		expect((await reclaimable.json()).providers[0]).toMatchObject({
			claimed: false,
			myClaimStatus: null,
		});

		// Re-claim and approve → active, with routing settings provisioned.
		const secondClaim = await claimProvider(cookie, company.id);
		const approved = await app.request(
			`/admin/airside/claims/${secondClaim.id}/approve`,
			json(cookie),
		);
		expect(approved.status).toBe(200);
		expect((await approved.json()).claim.status).toBe("active");

		// Re-review of the same claim conflicts.
		const again = await app.request(
			`/admin/airside/claims/${secondClaim.id}/approve`,
			json(cookie),
		);
		expect(again.status).toBe(409);

		const settings = await db.query.providerRoutingSettings.findFirst({
			where: { providerId: { eq: "mistral" } },
		});
		expect(settings).toBeTruthy();
	});

	it("drafts a model with an initial price filing and blocks price edits", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();

		const created = await createModel(cookie, company.id);
		expect(created.status).toBe(201);
		const { model } = await created.json();
		expect(model).toMatchObject({
			status: "draft",
			currentPricing: null,
			pendingFiling: expect.objectContaining({
				kind: "initial",
				status: "pending",
				inputPrice: "2e-6",
			}),
		});

		// Non-pricing edits apply immediately.
		const patched = await app.request(
			`/airside/models/${model.id}`,
			json(cookie, { displayName: "Mistral Large 3 Turbo" }, "PATCH"),
		);
		expect(patched.status).toBe(200);
		expect((await patched.json()).model.displayName).toBe(
			"Mistral Large 3 Turbo",
		);

		// A second filing can't be submitted while one is pending.
		const doubleFiling = await app.request(
			`/airside/models/${model.id}/price-filings`,
			json(cookie, { inputPrice: "1e-6", outputPrice: "3e-6" }),
		);
		expect(doubleFiling.status).toBe(409);

		// Duplicate live model names for the provider are rejected.
		const duplicate = await createModel(cookie, company.id);
		expect(duplicate.status).toBe(409);

		// Drafts delete outright.
		const deleted = await app.request(`/airside/models/${model.id}`, {
			method: "DELETE",
			headers: { Cookie: cookie },
		});
		expect((await deleted.json()).status).toBe("deleted");
	});

	it("requires a claimed provider to list models", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		const res = await createModel(cookie, company.id);
		expect(res.status).toBe(403);
	});

	it("scopes company resources to members", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await db
			.delete(tables.providerCompanyMember)
			.where(eq(tables.providerCompanyMember.providerCompanyId, company.id));
		const res = await app.request(
			`/airside/models?providerCompanyId=${company.id}`,
			{ headers: { Cookie: cookie } },
		);
		expect(res.status).toBe(404);
	});

	it("runs the approval lifecycle through the admin queue", async () => {
		process.env.ADMIN_EMAILS = "ops@mistral.ai";
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();
		const created = await createModel(cookie, company.id);
		const { model } = await created.json();
		const filingId = model.pendingFiling.id as string;

		const queue = await app.request("/admin/airside/filings?status=pending", {
			headers: { Cookie: cookie },
		});
		expect(queue.status).toBe(200);
		const queueBody = await queue.json();
		expect(queueBody.pendingCount).toBe(1);
		expect(queueBody.filings[0]).toMatchObject({
			id: filingId,
			kind: "initial",
			company: expect.objectContaining({ name: "Mistral Ops" }),
			model: expect.objectContaining({ modelName: "mistral-large-3" }),
		});

		// Approve the initial filing → model activates, pricing becomes current.
		const approved = await app.request(
			`/admin/airside/filings/${filingId}/approve`,
			json(cookie),
		);
		expect(approved.status).toBe(200);
		const models = await app.request(
			`/airside/models?providerCompanyId=${company.id}`,
			{ headers: { Cookie: cookie } },
		);
		const active = (await models.json()).models[0];
		expect(active).toMatchObject({
			status: "active",
			currentPricing: expect.objectContaining({ inputPrice: "2e-6" }),
			pendingFiling: null,
		});

		// Active models delist instead of deleting.
		// First file a price update and reject it: pricing must stay unchanged.
		const update = await app.request(
			`/airside/models/${model.id}/price-filings`,
			json(cookie, { inputPrice: "4e-6", outputPrice: "9e-6" }),
		);
		expect(update.status).toBe(201);
		const updateFiling = (await update.json()).filing;
		expect(updateFiling.kind).toBe("update");

		const rejected = await app.request(
			`/admin/airside/filings/${updateFiling.id}/reject`,
			json(cookie, { reviewNote: "Too steep" }),
		);
		expect(rejected.status).toBe(200);

		const afterReject = await app.request(
			`/airside/models?providerCompanyId=${company.id}`,
			{ headers: { Cookie: cookie } },
		);
		const stillActive = (await afterReject.json()).models[0];
		expect(stillActive).toMatchObject({
			status: "active",
			currentPricing: expect.objectContaining({ inputPrice: "2e-6" }),
			pendingFiling: null,
		});

		// Re-review of the same filing conflicts.
		const again = await app.request(
			`/admin/airside/filings/${updateFiling.id}/reject`,
			json(cookie, {}),
		);
		expect(again.status).toBe(409);

		const delisted = await app.request(`/airside/models/${model.id}`, {
			method: "DELETE",
			headers: { Cookie: cookie },
		});
		expect((await delisted.json()).status).toBe("delisted");
	});

	it("rejects admin queue access for non-admins", async () => {
		process.env.ADMIN_EMAILS = "someone-else@example.com";
		const res = await app.request("/admin/airside/filings", {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(403);
	});

	it("returns provider-scoped usage stats", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();

		const hour = new Date();
		hour.setMinutes(0, 0, 0);
		await db.insert(tables.projectHourlyModelStats).values([
			{
				projectId: "test-project-id",
				hourTimestamp: hour,
				usedModel: "mistral-large-3",
				usedProvider: "mistral",
				requestCount: 10,
				errorCount: 1,
				inputTokens: "1000",
				outputTokens: "500",
				totalTokens: "1500",
				cost: 2,
			},
			{
				projectId: "test-project-id",
				hourTimestamp: hour,
				usedModel: "gpt-6",
				usedProvider: "openai",
				requestCount: 99,
				inputTokens: "9999",
				outputTokens: "9999",
				totalTokens: "19998",
				cost: 50,
			},
		]);

		const res = await app.request(
			`/airside/stats?providerCompanyId=${company.id}&days=7`,
			{ headers: { Cookie: cookie } },
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.providerIds).toEqual(["mistral"]);
		expect(body.totals).toMatchObject({
			requestCount: 10,
			errorCount: 1,
			cost: 2,
		});
		// Default margin 20% → estimated payout is 80% of billed cost.
		expect(body.totals.estimatedPayout).toBeCloseTo(1.6);
		expect(body.byModel).toEqual([
			expect.objectContaining({
				providerId: "mistral",
				model: "mistral-large-3",
				requestCount: 10,
			}),
		]);
		expect(body.daily).toHaveLength(1);
	});

	it("gates claims on the listing fee when configured", async () => {
		process.env.AIRSIDE_LISTING_PRICE_ID = "price_test_airside";
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);

		const gated = await app.request(
			"/airside/claims",
			json(cookie, { providerCompanyId: company.id, providerId: "mistral" }),
		);
		expect(gated.status).toBe(402);

		// The webhook marks the company paid; simulate its write.
		await db
			.update(tables.providerCompany)
			.set({ paymentStatus: "paid", paidAt: new Date() })
			.where(eq(tables.providerCompany.id, company.id));
		const claimed = await app.request(
			"/airside/claims",
			json(cookie, { providerCompanyId: company.id, providerId: "mistral" }),
		);
		expect(claimed.status).toBe(201);

		// Companies expose the payment state to the portal.
		const companies = await app.request("/airside/companies", {
			headers: { Cookie: cookie },
		});
		expect((await companies.json()).companies[0]).toMatchObject({
			paymentStatus: "paid",
			paymentRequired: true,
		});
	});

	it("stores claim branding and serves it on internal providers", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		// Branding uploads are SVG-only; other image formats are rejected.
		const pngRes = await app.request(
			"/airside/claims",
			json(cookie, {
				providerCompanyId: company.id,
				providerId: "mistral",
				logoUrl: `data:image/png;base64,${"A".repeat(64)}`,
			}),
		);
		expect(pngRes.status).toBe(400);
		const logoUrl = `data:image/svg+xml;base64,${"A".repeat(64)}`;
		const res = await app.request(
			"/airside/claims",
			json(cookie, {
				providerCompanyId: company.id,
				providerId: "mistral",
				logoUrl,
			}),
		);
		expect(res.status).toBe(201);
		expect((await res.json()).claim.logoUrl).toBe(logoUrl);
		await activateClaim();

		await db
			.insert(tables.provider)
			.values({ id: "mistral", name: "Mistral", description: "" })
			.onConflictDoNothing();
		const providersRes = await app.request("/internal/providers");
		const { providers } = await providersRes.json();
		const mistral = providers.find((p: { id: string }) => p.id === "mistral");
		expect(mistral.airsideLogoUrl).toBe(logoUrl);
	});

	it("round-trips carrier rate limits on models", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();
		const created = await createModel(cookie, company.id, {
			maxRpm: 60,
			maxRpd: 20000,
		});
		expect(created.status).toBe(201);
		const { model } = await created.json();
		expect(model).toMatchObject({ maxRpm: 60, maxRpd: 20000 });

		const patched = await app.request(
			`/airside/models/${model.id}`,
			json(cookie, { maxRpm: 30, maxRpd: null }, "PATCH"),
		);
		expect(patched.status).toBe(200);
		expect((await patched.json()).model).toMatchObject({
			maxRpm: 30,
			maxRpd: null,
		});
	});

	it("materializes approved listings into the DB catalogue", async () => {
		process.env.ADMIN_EMAILS = "ops@mistral.ai";
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();
		const created = await createModel(cookie, company.id);
		const { model } = await created.json();

		// Drafts are not in the catalogue yet.
		expect(
			await db.query.modelProviderMapping.findFirst({
				where: { modelId: { eq: "mistral-large-3" } },
			}),
		).toBeFalsy();

		await app.request(
			`/admin/airside/filings/${model.pendingFiling.id}/approve`,
			json(cookie),
		);
		const mapping = await db.query.modelProviderMapping.findFirst({
			where: { modelId: { eq: "mistral-large-3" } },
		});
		expect(mapping).toMatchObject({
			providerId: "mistral",
			externalId: "mistral-large-3",
			status: "active",
		});
		expect(Number(mapping!.inputPrice)).toBeCloseTo(2e-6);
		const catalogueModel = await db.query.model.findFirst({
			where: { id: { eq: "mistral-large-3" } },
		});
		expect(catalogueModel).toMatchObject({ family: "airside" });

		// A price-update approval rewrites the mapping's prices.
		const update = await app.request(
			`/airside/models/${model.id}/price-filings`,
			json(cookie, { inputPrice: "4e-6", outputPrice: "9e-6" }),
		);
		const updateFiling = (await update.json()).filing;
		await app.request(
			`/admin/airside/filings/${updateFiling.id}/approve`,
			json(cookie),
		);
		const repriced = await db.query.modelProviderMapping.findFirst({
			where: { modelId: { eq: "mistral-large-3" } },
		});
		expect(Number(repriced!.inputPrice)).toBeCloseTo(4e-6);

		// Delisting removes the materialized rows again.
		await app.request(`/airside/models/${model.id}`, {
			method: "DELETE",
			headers: { Cookie: cookie },
		});
		expect(
			await db.query.modelProviderMapping.findFirst({
				where: { modelId: { eq: "mistral-large-3" } },
			}),
		).toBeFalsy();
		expect(
			await db.query.model.findFirst({
				where: { id: { eq: "mistral-large-3" } },
			}),
		).toBeFalsy();
	});

	it("refuses listings that shadow the static catalogue", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();
		const res = await createModel(cookie, company.id, {
			modelName: "mistral-large-latest",
		});
		expect(res.status).toBe(409);
	});

	it("rejects malformed price strings", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();
		for (const bad of ["", " ", "0x1F", "-1e-6", "1,4e-6"]) {
			const res = await createModel(cookie, company.id, {
				pricing: { inputPrice: bad, outputPrice: "1e-6" },
			});
			expect(res.status).toBe(400);
		}
	});

	it("reports an admin-owned multiplier instead of pretending to apply", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();
		await db.insert(tables.routingScoreMultiplier).values({
			provider: "mistral",
			model: null,
			scoreMultiplier: "0.5",
			reason: "manual penalty",
		});

		const updated = await app.request(
			"/airside/routing-settings/mistral",
			json(
				cookie,
				{
					providerCompanyId: company.id,
					discountPercent: 0.2,
					marginPercent: 0.3,
				},
				"PUT",
			),
		);
		expect(updated.status).toBe(200);
		const { settings } = await updated.json();
		// The admin row shadows the carrier's settings and is reported as-is.
		expect(settings.adjustmentSource).toBe("admin");
		expect(settings.routingAdjustment).toBeCloseTo(0.5);

		const listed = await app.request(
			`/airside/routing-settings?providerCompanyId=${company.id}`,
			{ headers: { Cookie: cookie } },
		);
		expect((await listed.json()).settings[0]).toMatchObject({
			adjustmentSource: "admin",
		});
		await db.delete(tables.routingScoreMultiplier);
	});

	it("revokes an active carrier and tears down its routing state", async () => {
		process.env.ADMIN_EMAILS = "ops@mistral.ai";
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		const claim = await claimProvider(cookie, company.id);
		const approved = await app.request(
			`/admin/airside/claims/${claim.id}/approve`,
			json(cookie),
		);
		expect(approved.status).toBe(200);

		// Give the carrier a live boost first.
		await app.request(
			"/airside/routing-settings/mistral",
			json(
				cookie,
				{
					providerCompanyId: company.id,
					discountPercent: 0.1,
					marginPercent: 0.3,
				},
				"PUT",
			),
		);
		expect(
			await db.query.routingScoreMultiplier.findFirst({
				where: { provider: { eq: "mistral" } },
			}),
		).toBeTruthy();

		// A live listing exists at revocation time.
		const listed = await createModel(cookie, company.id);
		expect(listed.status).toBe(201);
		const listedModel = (await listed.json()).model;

		const revoked = await app.request(
			`/admin/airside/claims/${claim.id}/revoke`,
			json(cookie, { reviewNote: "Ownership dispute" }),
		);
		expect(revoked.status).toBe(200);
		expect((await revoked.json()).claim.status).toBe("revoked");

		// Revocation ends portal control: the listing is delisted and its
		// pending filing rejected.
		const deadModel = await db.query.providerDraftModel.findFirst({
			where: { id: { eq: listedModel.id } },
		});
		expect(deadModel!.status).toBe("delisted");
		const deadFiling = await db.query.providerPriceFiling.findFirst({
			where: { draftModelId: { eq: listedModel.id } },
		});
		expect(deadFiling!.status).toBe("rejected");
		expect(deadFiling!.reviewNote).toBe("Carrier claim revoked");

		// Boost and settings are gone; the provider is claimable again.
		expect(
			await db.query.routingScoreMultiplier.findFirst({
				where: { provider: { eq: "mistral" } },
			}),
		).toBeFalsy();
		expect(
			await db.query.providerRoutingSettings.findFirst({
				where: { providerId: { eq: "mistral" } },
			}),
		).toBeFalsy();
		const claimable = await app.request("/airside/claimable", {
			headers: { Cookie: cookie },
		});
		expect((await claimable.json()).providers[0]).toMatchObject({
			claimed: false,
		});
		// Revoking twice conflicts.
		const again = await app.request(
			`/admin/airside/claims/${claim.id}/revoke`,
			json(cookie, {}),
		);
		expect(again.status).toBe(409);
	});

	it("updates routing settings and mirrors them into routing multipliers", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();

		const defaults = await app.request(
			`/airside/routing-settings?providerCompanyId=${company.id}`,
			{ headers: { Cookie: cookie } },
		);
		const defaultsBody = await defaults.json();
		expect(defaultsBody.baselineMargin).toBe(0.2);
		expect(defaultsBody.settings[0]).toMatchObject({
			providerId: "mistral",
			marginPercent: 0.2,
			discountPercent: 0,
			routingAdjustment: 0,
			adjustmentSource: "none",
		});

		// Accepting a larger gateway margin + a discount → negative adjustment
		// (routing boost): 0.2 − 0.3 − 0.1 = −0.2.
		const updated = await app.request(
			"/airside/routing-settings/mistral",
			json(
				cookie,
				{
					providerCompanyId: company.id,
					discountPercent: 0.1,
					marginPercent: 0.3,
				},
				"PUT",
			),
		);
		expect(updated.status).toBe(200);
		const { settings } = await updated.json();
		expect(settings.routingAdjustment).toBeCloseTo(-0.2);
		expect(settings.adjustmentSource).toBe("airside");

		const multiplier = await db.query.routingScoreMultiplier.findFirst({
			where: { provider: { eq: "mistral" } },
		});
		expect(multiplier).toBeTruthy();
		expect(Number(multiplier!.scoreMultiplier)).toBeCloseTo(-0.2);

		// Returning to neutral removes the mirror row again.
		const neutral = await app.request(
			"/airside/routing-settings/mistral",
			json(
				cookie,
				{
					providerCompanyId: company.id,
					discountPercent: 0,
					marginPercent: 0.2,
				},
				"PUT",
			),
		);
		expect(neutral.status).toBe(200);
		const gone = await db.query.routingScoreMultiplier.findFirst({
			where: { provider: { eq: "mistral" } },
		});
		expect(gone).toBeFalsy();

		// Out-of-bounds margins are rejected.
		const outOfBounds = await app.request(
			"/airside/routing-settings/mistral",
			json(
				cookie,
				{
					providerCompanyId: company.id,
					discountPercent: 0,
					marginPercent: 0.9,
				},
				"PUT",
			),
		);
		expect(outOfBounds.status).toBe(400);
	});

	it("stores reasoning efforts and audio on a listing", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();
		const res = await createModel(cookie, company.id, {
			modelName: "mistral-reasoner-x",
			reasoning: true,
			audio: true,
			reasoningEfforts: ["low", "medium", "high"],
		});
		expect(res.status).toBe(201);
		const { model } = await res.json();
		expect(model.audio).toBe(true);
		expect(model.reasoningEfforts).toEqual(["low", "medium", "high"]);

		// Edits to the efforts persist.
		const patch = await app.request(
			`/airside/models/${model.id}`,
			json(cookie, { reasoningEfforts: ["medium", "max"] }, "PATCH"),
		);
		expect(patch.status).toBe(200);
		expect((await patch.json()).model.reasoningEfforts).toEqual([
			"medium",
			"max",
		]);
		const stored = await db.query.providerDraftModel.findFirst({
			where: { id: { eq: model.id } },
		});
		expect(stored?.reasoningEfforts).toEqual(["medium", "max"]);

		// Materialization carries the efforts onto the catalogue mapping.
		process.env.ADMIN_EMAILS = "ops@mistral.ai";
		const filings = await app.request(
			`/airside/filings?providerCompanyId=${company.id}`,
			{ headers: { Cookie: cookie } },
		);
		const filing = (await filings.json()).filings.find(
			(f: { status: string }) => f.status === "pending",
		);
		const approve = await app.request(
			`/admin/airside/filings/${filing.id}/approve`,
			json(cookie),
		);
		expect(approve.status).toBe(200);
		const mapping = await db.query.modelProviderMapping.findFirst({
			where: { modelId: { eq: "mistral-reasoner-x" } },
		});
		// The patched efforts (not the original ones) are what materialize.
		expect(mapping?.reasoningEfforts).toEqual(["medium", "max"]);
	});

	it("edits claim branding but never claim identity", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		const claim = await claimProvider(cookie, company.id);
		await activateClaim();

		const svg = `data:image/svg+xml;base64,${"B".repeat(64)}`;
		const res = await app.request(
			`/airside/claims/${claim.id}`,
			json(
				cookie,
				{ logoUrl: svg, customBaseUrl: "https://evil.example" },
				"PATCH",
			),
		);
		expect(res.status).toBe(200);
		const updated = (await res.json()).claim;
		expect(updated.logoUrl).toBe(svg);
		// Identity fields are not editable; unknown keys are stripped.
		expect(updated.customBaseUrl).toBeNull();

		// Non-SVG branding is rejected; null clears the logo.
		const png = await app.request(
			`/airside/claims/${claim.id}`,
			json(
				cookie,
				{ logoUrl: `data:image/png;base64,${"B".repeat(64)}` },
				"PATCH",
			),
		);
		expect(png.status).toBe(400);
		const cleared = await app.request(
			`/airside/claims/${claim.id}`,
			json(cookie, { logoUrl: null }, "PATCH"),
		);
		expect((await cleared.json()).claim.logoUrl).toBeNull();
	});

	it("carries cache and per-request pricing through filings", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();
		const res = await createModel(cookie, company.id, {
			modelName: "mistral-cached-x",
			pricing: {
				inputPrice: "2e-6",
				outputPrice: "6e-6",
				cachedInputPrice: "5e-7",
				requestPrice: "0.002",
			},
		});
		expect(res.status).toBe(201);
		const { model } = await res.json();
		expect(model.pendingFiling).toMatchObject({
			cachedInputPrice: "5e-7",
			requestPrice: "0.002",
		});
	});

	it("imports catalogue models as managed listings", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();

		const res = await app.request(
			"/airside/models/import",
			json(cookie, { providerCompanyId: company.id, providerId: "mistral" }),
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.imported.length).toBeGreaterThan(0);
		expect(body.imported).toContain("mistral-large-latest");

		// Imported listings are active with the current price as an approved
		// filing — manageable in Airside, still routed via the static catalogue.
		const row = await db.query.providerDraftModel.findFirst({
			where: {
				providerId: { eq: "mistral" },
				modelName: { eq: "mistral-large-latest" },
			},
			with: { priceFilings: true },
		});
		expect(row?.status).toBe("active");
		const approved = row?.priceFilings?.find(
			(f: { status: string }) => f.status === "approved",
		);
		expect(approved?.reviewNote).toBe("Imported from the catalogue");

		// Re-importing skips everything already listed.
		const again = await app.request(
			"/airside/models/import",
			json(cookie, { providerCompanyId: company.id, providerId: "mistral" }),
		);
		const secondBody = await again.json();
		expect(secondBody.imported).toEqual([]);
		expect(secondBody.skipped).toContain("mistral-large-latest");
	});

	async function registerCarrier(
		testCookie: string,
		providerCompanyId: string,
		overrides: Record<string, unknown> = {},
	) {
		return await app.request(
			"/airside/carriers",
			json(testCookie, {
				providerCompanyId,
				providerId: "acme-sky",
				name: "Acme Sky",
				baseUrl: "https://api.acme-sky.ai",
				...overrides,
			}),
		);
	}

	it("registers a new carrier as a pending custom claim", async () => {
		await setUserEmail("ops@acme-sky.ai");
		const company = await createCompany(cookie, "Acme Sky");
		const res = await registerCarrier(cookie, company.id, {
			description: "Regional AI carrier",
		});
		expect(res.status).toBe(201);
		const { claim } = await res.json();
		expect(claim.kind).toBe("custom");
		expect(claim.status).toBe("pending");
		expect(claim.providerId).toBe("acme-sky");
		expect(claim.providerName).toBe("Acme Sky");
		expect(claim.customBaseUrl).toBe("https://api.acme-sky.ai");

		// Pending registration blocks the id for everyone.
		const dupe = await registerCarrier(cookie, company.id);
		expect(dupe.status).toBe(409);
	});

	it("rejects freemail accounts and flags them on the claimable list", async () => {
		await setUserEmail("someone@hotmail.com");
		const company = await createCompany(cookie, "Personal Co");
		const res = await registerCarrier(cookie, company.id, {
			baseUrl: "https://api.hotmail.com",
		});
		expect(res.status).toBe(403);

		const claimableRes = await app.request("/airside/claimable", {
			headers: { Cookie: cookie },
		});
		const claimableBody = await claimableRes.json();
		expect(claimableBody.emailDomainIsFreemail).toBe(true);
	});

	it("rejects a registration off the verified email domain", async () => {
		await setUserEmail("ops@acme-sky.ai");
		const company = await createCompany(cookie, "Acme Sky");
		const res = await registerCarrier(cookie, company.id, {
			baseUrl: "https://api.somebody-else.ai",
		});
		expect(res.status).toBe(403);
	});

	it("rejects catalogue and reserved carrier ids", async () => {
		await setUserEmail("ops@acme-sky.ai");
		const company = await createCompany(cookie, "Acme Sky");
		expect(
			(await registerCarrier(cookie, company.id, { providerId: "mistral" }))
				.status,
		).toBe(409);
		expect(
			(await registerCarrier(cookie, company.id, { providerId: "custom" }))
				.status,
		).toBe(409);
		expect(
			(await registerCarrier(cookie, company.id, { providerId: "Bad_Slug" }))
				.status,
		).toBe(400);
	});

	it("runs the custom carrier lifecycle: approve, credential, revoke", async () => {
		process.env.ADMIN_EMAILS = "ops@acme-sky.ai";
		await setUserEmail("ops@acme-sky.ai");
		const company = await createCompany(cookie, "Acme Sky");
		const res = await registerCarrier(cookie, company.id);
		expect(res.status).toBe(201);
		const { claim } = await res.json();

		// Approval creates the DB catalogue provider row.
		const approve = await app.request(
			`/admin/airside/claims/${claim.id}/approve`,
			json(cookie),
		);
		expect(approve.status).toBe(200);
		const providerRow = await db.query.provider.findFirst({
			where: { id: { eq: "acme-sky" } },
		});
		expect(providerRow?.name).toBe("Acme Sky");

		// The managed-credentials catalog now offers the carrier…
		const catalog = await app.request("/admin/provider-credentials/catalog", {
			headers: { Cookie: cookie },
		});
		expect(catalog.status).toBe(200);
		const catalogBody = await catalog.json();
		const entry = catalogBody.providers.find(
			(p: { id: string }) => p.id === "acme-sky",
		);
		expect(entry).toBeTruthy();
		expect(entry.configKeys).toEqual([]);

		// …and accepts a credential with no settings, but none with settings.
		const withConfig = await app.request(
			"/admin/provider-credentials",
			json(cookie, {
				provider: "acme-sky",
				token: "sk-acme-test",
				config: { baseUrl: "https://elsewhere.acme-sky.ai" },
			}),
		);
		expect(withConfig.status).toBe(400);
		const create = await app.request(
			"/admin/provider-credentials",
			json(cookie, {
				provider: "acme-sky",
				token: "sk-acme-test",
				config: {},
			}),
		);
		expect(create.status).toBe(201);

		// Revoking the claim removes the provider row again.
		const revoke = await app.request(
			`/admin/airside/claims/${claim.id}/revoke`,
			json(cookie, {}),
		);
		expect(revoke.status).toBe(200);
		const goneRow = await db.query.provider.findFirst({
			where: { id: { eq: "acme-sky" } },
		});
		expect(goneRow).toBeFalsy();
	});
});
