import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

const originalAdminEmails = process.env.ADMIN_EMAILS;
const CARRIER_ID = "airside-rate-limit-carrier";
const COMPANY_ID = "airside-rate-limit-company";
const CLAIM_ID = "airside-rate-limit-claim";
const MODEL_ID = "airside-rate-limit-model";
const MAPPING_ID = "airside-rate-limit-mapping";

interface RateLimitOptions {
	providers: { id: string; name: string; source: string }[];
	mappings: {
		providerId: string;
		modelId: string;
		modelName: string;
		source: string;
	}[];
}

interface RateLimitsList {
	rateLimits: {
		id: string;
		provider: string | null;
		model: string | null;
		maxRequests: number;
	}[];
}

async function clearFixtures() {
	await db
		.delete(tables.rateLimit)
		.where(eq(tables.rateLimit.provider, CARRIER_ID));
	await db
		.delete(tables.modelProviderMapping)
		.where(eq(tables.modelProviderMapping.id, MAPPING_ID));
	await db.delete(tables.model).where(eq(tables.model.id, MODEL_ID));
	await db
		.delete(tables.providerClaim)
		.where(eq(tables.providerClaim.id, CLAIM_ID));
	await db
		.delete(tables.providerCompany)
		.where(eq(tables.providerCompany.id, COMPANY_ID));
	await db.delete(tables.provider).where(eq(tables.provider.id, CARRIER_ID));
}

describe("admin rate limits for airside listings", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();
		await clearFixtures();

		await db.insert(tables.provider).values({
			id: CARRIER_ID,
			name: "Airside Rate Limit Carrier",
			description: "test",
		});
		await db.insert(tables.providerCompany).values({
			id: COMPANY_ID,
			name: "Airside Rate Limit Co",
		});
		await db.insert(tables.providerClaim).values({
			id: CLAIM_ID,
			providerCompanyId: COMPANY_ID,
			providerId: CARRIER_ID,
			kind: "custom",
			matchedDomain: "airside-rate-limit.example",
			customName: "Airside Rate Limit Carrier",
			customBaseUrl: "https://airside-rate-limit.example/v1",
			status: "active",
		});
		await db.insert(tables.model).values({
			id: MODEL_ID,
			name: "Airside Rate Limit Model",
			family: "test",
		});
		await db.insert(tables.modelProviderMapping).values({
			id: MAPPING_ID,
			modelId: MODEL_ID,
			providerId: CARRIER_ID,
			externalId: MODEL_ID,
			source: "airside",
		});
	});

	afterEach(async () => {
		await clearFixtures();
		process.env.ADMIN_EMAILS = originalAdminEmails;
	});

	test("options list airside carriers and their models", async () => {
		const response = await app.request("/admin/rate-limits/options", {
			headers: { Cookie: cookie },
		});
		expect(response.status).toBe(200);
		const options = (await response.json()) as RateLimitOptions;

		const carrier = options.providers.find((p) => p.id === CARRIER_ID);
		expect(carrier).toMatchObject({
			name: "Airside Rate Limit Carrier",
			source: "airside",
		});
		expect(options.mappings).toContainEqual(
			expect.objectContaining({
				providerId: CARRIER_ID,
				modelId: MODEL_ID,
				modelName: "Airside Rate Limit Model",
				source: "airside",
			}),
		);
		// The static catalogue is still offered alongside the DB listings.
		expect(options.providers.some((p) => p.source === "catalogue")).toBe(true);
	});

	test("creating and deleting a rate limit on an airside listing", async () => {
		const created = await app.request("/admin/rate-limits", {
			method: "POST",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({
				provider: CARRIER_ID,
				model: MODEL_ID,
				limitType: "rpm",
				maxRequests: 42,
				enforcement: "global",
			}),
		});
		expect(created.status).toBe(201);

		const list = await app.request("/admin/rate-limits", {
			headers: { Cookie: cookie },
		});
		const { rateLimits } = (await list.json()) as RateLimitsList;
		const entry = rateLimits.find(
			(r) => r.provider === CARRIER_ID && r.model === MODEL_ID,
		);
		expect(entry?.maxRequests).toBe(42);

		const deleted = await app.request(`/admin/rate-limits/${entry!.id}`, {
			method: "DELETE",
			headers: { Cookie: cookie },
		});
		expect(deleted.status).toBe(200);

		const afterDelete = await app.request("/admin/rate-limits", {
			headers: { Cookie: cookie },
		});
		const after = (await afterDelete.json()) as RateLimitsList;
		expect(after.rateLimits.some((r) => r.provider === CARRIER_ID)).toBe(false);
	});

	test("carrier-wide rate limit without a model is accepted", async () => {
		const response = await app.request("/admin/rate-limits", {
			method: "POST",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({
				provider: CARRIER_ID,
				limitType: "rpd",
				maxRequests: 1000,
			}),
		});
		expect(response.status).toBe(201);
	});

	test.each(["rpm", "rpd"] as const)(
		"accepts zero global %s caps with either enforcement",
		async (limitType) => {
			for (const enforcement of ["global", "per_org"]) {
				const response = await app.request("/admin/rate-limits", {
					method: "POST",
					headers: { Cookie: cookie, "Content-Type": "application/json" },
					body: JSON.stringify({
						provider: CARRIER_ID,
						limitType,
						maxRequests: 0,
						enforcement,
					}),
				});
				expect(response.status).toBe(201);
				expect(await response.json()).toMatchObject({
					maxRequests: 0,
					enforcement,
				});
				await db
					.delete(tables.rateLimit)
					.where(eq(tables.rateLimit.provider, CARRIER_ID));
			}
		},
	);

	test.each([-1, 0.5])(
		"rejects invalid global limit %s",
		async (maxRequests) => {
			const response = await app.request("/admin/rate-limits", {
				method: "POST",
				headers: { Cookie: cookie, "Content-Type": "application/json" },
				body: JSON.stringify({
					provider: CARRIER_ID,
					limitType: "rpd",
					maxRequests,
				}),
			});
			expect(response.status).toBe(400);
		},
	);

	test("still rejects zero on organization-specific limits", async () => {
		const response = await app.request(
			"/admin/organizations/test-org/rate-limits",
			{
				method: "POST",
				headers: { Cookie: cookie, "Content-Type": "application/json" },
				body: JSON.stringify({
					provider: CARRIER_ID,
					limitType: "rpd",
					maxRequests: 0,
				}),
			},
		);
		expect(response.status).toBe(400);
	});

	test("unknown providers and models are still rejected", async () => {
		const unknownProvider = await app.request("/admin/rate-limits", {
			method: "POST",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({
				provider: "not-a-carrier",
				limitType: "rpm",
				maxRequests: 5,
			}),
		});
		expect(unknownProvider.status).toBe(400);

		const unknownModel = await app.request("/admin/rate-limits", {
			method: "POST",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({
				provider: CARRIER_ID,
				model: "not-a-listed-model",
				limitType: "rpm",
				maxRequests: 5,
			}),
		});
		expect(unknownModel.status).toBe(400);
	});
});
