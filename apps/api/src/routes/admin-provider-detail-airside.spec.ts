import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser } from "@/testing.js";

import { computeAirsideAdjustment, db, eq, tables } from "@llmgateway/db";

const originalAdminEmails = process.env.ADMIN_FULL_ACCESS_EMAILS;
const CARRIER_ID = "airside-detail-carrier";
const COMPANY_ID = "airside-detail-company";
const CLAIM_ID = "airside-detail-claim";
const SETTINGS_ID = "airside-detail-settings";
const OVERRIDE_ID = "airside-detail-override";
const FILING_ID = "airside-detail-filing";
const MODEL_ID = "airside-detail-model";
const MAPPING_ID = "airside-detail-mapping";

interface ProviderDetail {
	provider: { id: string; name: string };
	airside: {
		company: { id: string; name: string };
		claimKind: string;
		discountPercent: number;
		marginPercent: number;
		routingAdjustment: number;
		settingsUpdatedAt: string;
		settings: {
			customBaseUrl: string | null;
			verificationKeyMasked: string | null;
			modelOverrides: { modelId: string; discountPercent: number }[];
			pendingFilings: { id: string; modelId: string | null }[];
		};
	} | null;
	models: { modelId: string; mappingId: string }[];
}

async function clearFixtures() {
	await db
		.delete(tables.modelProviderMapping)
		.where(eq(tables.modelProviderMapping.id, MAPPING_ID));
	await db.delete(tables.model).where(eq(tables.model.id, MODEL_ID));
	await db
		.delete(tables.providerRoutingFiling)
		.where(eq(tables.providerRoutingFiling.id, FILING_ID));
	await db
		.delete(tables.providerRoutingSettings)
		.where(eq(tables.providerRoutingSettings.providerId, CARRIER_ID));
	await db
		.delete(tables.providerClaim)
		.where(eq(tables.providerClaim.id, CLAIM_ID));
	await db
		.delete(tables.providerCompany)
		.where(eq(tables.providerCompany.id, COMPANY_ID));
	await db.delete(tables.provider).where(eq(tables.provider.id, CARRIER_ID));
}

describe("admin provider detail for airside carriers", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "admin@example.com";
		cookie = await createTestUser();
		await clearFixtures();

		await db.insert(tables.provider).values({
			id: CARRIER_ID,
			name: "Airside Detail Carrier",
			description: "test",
		});
		await db.insert(tables.providerCompany).values({
			id: COMPANY_ID,
			name: "Airside Detail Co",
		});
		await db.insert(tables.providerClaim).values({
			id: CLAIM_ID,
			providerCompanyId: COMPANY_ID,
			providerId: CARRIER_ID,
			kind: "custom",
			matchedDomain: "airside-detail.example",
			customName: "Airside Detail Carrier",
			customBaseUrl: "https://airside-detail.example/v1",
			status: "active",
		});
		await db.insert(tables.model).values({
			id: MODEL_ID,
			name: "Airside Detail Model",
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
		process.env.ADMIN_FULL_ACCESS_EMAILS = originalAdminEmails;
	});

	test("exposes the carrier's routing settings alongside its mappings", async () => {
		await db.insert(tables.providerRoutingSettings).values({
			id: SETTINGS_ID,
			providerCompanyId: COMPANY_ID,
			providerId: CARRIER_ID,
			discountPercent: "0.1",
			marginPercent: "0.3",
		});

		const response = await app.request(`/admin/providers/${CARRIER_ID}`, {
			headers: { Cookie: cookie },
		});
		expect(response.status).toBe(200);
		const detail = (await response.json()) as ProviderDetail;

		expect(detail.airside).toMatchObject({
			company: { id: COMPANY_ID, name: "Airside Detail Co" },
			claimKind: "custom",
			discountPercent: 0.1,
			marginPercent: 0.3,
			routingAdjustment: computeAirsideAdjustment(0.1, 0.3),
		});
		// The mappings the carrier can be verified against come back with it.
		expect(detail.models).toContainEqual(
			expect.objectContaining({ modelId: MODEL_ID, mappingId: MAPPING_ID }),
		);
	});

	test("exposes the carrier's portal settings", async () => {
		await db
			.update(tables.providerClaim)
			.set({ verificationKeyMasked: "sk-...abcd" })
			.where(eq(tables.providerClaim.id, CLAIM_ID));
		await db.insert(tables.providerRoutingSettings).values({
			id: OVERRIDE_ID,
			providerCompanyId: COMPANY_ID,
			providerId: CARRIER_ID,
			modelId: MODEL_ID,
			discountPercent: "0.05",
		});
		await db.insert(tables.providerRoutingFiling).values({
			id: FILING_ID,
			providerCompanyId: COMPANY_ID,
			providerId: CARRIER_ID,
			discountPercent: "0.2",
			marginPercent: "0.2",
		});

		const response = await app.request(`/admin/providers/${CARRIER_ID}`, {
			headers: { Cookie: cookie },
		});
		const detail = (await response.json()) as ProviderDetail;
		expect(detail.airside?.settings).toMatchObject({
			customBaseUrl: "https://airside-detail.example/v1",
			verificationKeyMasked: "sk-...abcd",
			modelOverrides: [{ modelId: MODEL_ID, discountPercent: 0.05 }],
			pendingFilings: [{ id: FILING_ID, modelId: null }],
		});
	});

	test("falls back to the default margin when no routing row exists", async () => {
		const response = await app.request(`/admin/providers/${CARRIER_ID}`, {
			headers: { Cookie: cookie },
		});
		const detail = (await response.json()) as ProviderDetail;
		expect(detail.airside).toMatchObject({
			discountPercent: 0,
			marginPercent: 0.2,
			routingAdjustment: 0,
		});
	});

	test("a revoked claim leaves the provider without carrier data", async () => {
		await db
			.update(tables.providerClaim)
			.set({ status: "revoked" })
			.where(eq(tables.providerClaim.id, CLAIM_ID));

		const response = await app.request(`/admin/providers/${CARRIER_ID}`, {
			headers: { Cookie: cookie },
		});
		const detail = (await response.json()) as ProviderDetail;
		expect(detail.airside).toBeNull();
	});
});
