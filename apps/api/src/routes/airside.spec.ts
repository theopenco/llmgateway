import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

const originalAdminEmails = process.env.ADMIN_EMAILS;

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
		});

		// Lower accepted margin + discount → negative adjustment (boost).
		const updated = await app.request(
			"/airside/routing-settings/mistral",
			json(
				cookie,
				{
					providerCompanyId: company.id,
					discountPercent: 0.1,
					marginPercent: 0.1,
				},
				"PUT",
			),
		);
		expect(updated.status).toBe(200);
		const { settings } = await updated.json();
		expect(settings.routingAdjustment).toBeCloseTo(-0.2);

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
});
