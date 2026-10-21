import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

const originalAdminEmails = process.env.ADMIN_FULL_ACCESS_EMAILS;
const originalViewerEmails = process.env.ADMIN_VIEWER_EMAILS;
const CARRIER_ID = "airworthy-spec-carrier";
const COMPANY_ID = "airworthy-spec-company";
const CLAIM_ID = "airworthy-spec-claim";

const COMPLETE_PROFILE = {
	website: "https://airworthy-spec.example",
	privacyPolicyUrl: "https://airworthy-spec.example/privacy",
	termsUrl: "https://airworthy-spec.example/terms",
	legalEntity: "Airworthy Spec B.V.",
	headquarters: "NL",
	apiTraining: false,
	promptLogging: false,
	retentionPeriod: "None",
	gdpr: true,
	soc2: 2,
	iso27001: null,
	profileUpdatedAt: new Date(),
};

interface Carrier {
	claimId: string;
	missingKeys: string[];
	certification: {
		id: string;
		certificateNumber: string;
		state: string;
		driftedKeys: string[];
		issuedByEmail: string | null;
	} | null;
	history: { certificateNumber: string; revokeReason: string | null }[];
}

async function clearFixtures() {
	await db
		.delete(tables.providerClaim)
		.where(eq(tables.providerClaim.id, CLAIM_ID));
	await db
		.delete(tables.providerCompany)
		.where(eq(tables.providerCompany.id, COMPANY_ID));
	await db.delete(tables.provider).where(eq(tables.provider.id, CARRIER_ID));
}

describe("Airworthy certification", () => {
	let cookie: string;

	const REVIEWED = {
		legalEntity: COMPLETE_PROFILE.legalEntity,
		headquarters: COMPLETE_PROFILE.headquarters,
		apiTraining: COMPLETE_PROFILE.apiTraining,
		promptLogging: COMPLETE_PROFILE.promptLogging,
		retentionPeriod: COMPLETE_PROFILE.retentionPeriod,
		gdpr: COMPLETE_PROFILE.gdpr,
		soc2: COMPLETE_PROFILE.soc2,
		iso27001: COMPLETE_PROFILE.iso27001,
	};

	const certify = (attested: Record<string, unknown> = REVIEWED) =>
		app.request(`/admin/airside/claims/${CLAIM_ID}/certification`, {
			method: "POST",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({
				reviewNote: "DPA, registry extract and SOC 2 report",
				attested,
			}),
		});

	const revoke = (id: string) =>
		app.request(`/admin/airside/certifications/${id}/revoke`, {
			method: "POST",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ reason: "Retention claim withdrawn" }),
		});

	const adminCarrier = async () => {
		const response = await app.request("/admin/airside/certifications", {
			headers: { Cookie: cookie },
		});
		expect(response.status).toBe(200);
		const { carriers } = (await response.json()) as { carriers: Carrier[] };
		return carriers.find((carrier) => carrier.claimId === CLAIM_ID);
	};

	const publicCertificate = async () => {
		const response = await app.request("/internal/providers");
		const { providers } = (await response.json()) as {
			providers: {
				id: string;
				airsideCertification: { certificateNumber: string } | null;
			}[];
		};
		return providers.find((provider) => provider.id === CARRIER_ID)
			?.airsideCertification;
	};

	beforeEach(async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "admin@example.com";
		delete process.env.ADMIN_VIEWER_EMAILS;
		cookie = await createTestUser();
		await clearFixtures();
		await db.insert(tables.provider).values({
			id: CARRIER_ID,
			name: "Airworthy Spec Carrier",
			description: "test",
		});
		await db.insert(tables.providerCompany).values({
			id: COMPANY_ID,
			name: "Airworthy Spec Co",
		});
		await db.insert(tables.providerClaim).values({
			id: CLAIM_ID,
			providerCompanyId: COMPANY_ID,
			providerId: CARRIER_ID,
			kind: "custom",
			matchedDomain: "airworthy-spec.example",
			customName: "Airworthy Spec Carrier",
			customBaseUrl: "https://airworthy-spec.example/v1",
			status: "active",
			...COMPLETE_PROFILE,
		});
	});

	afterEach(async () => {
		await clearFixtures();
		process.env.ADMIN_FULL_ACCESS_EMAILS = originalAdminEmails;
		if (originalViewerEmails === undefined) {
			delete process.env.ADMIN_VIEWER_EMAILS;
		} else {
			process.env.ADMIN_VIEWER_EMAILS = originalViewerEmails;
		}
	});

	test("refuses a carrier whose profile leaves a required claim unstated", async () => {
		await db
			.update(tables.providerClaim)
			.set({ headquarters: null, retentionPeriod: null })
			.where(eq(tables.providerClaim.id, CLAIM_ID));

		const response = await certify();
		expect(response.status).toBe(400);
		expect(((await response.json()) as { message: string }).message).toBe(
			"The carrier's profile must state its headquarters and retention period before it can be certified.",
		);
		expect((await adminCarrier())?.missingKeys).toEqual([
			"headquarters",
			"retentionPeriod",
		]);
		expect(await publicCertificate()).toBeNull();
	});

	test("issues a certificate that the provider page shows", async () => {
		const response = await certify();
		expect(response.status).toBe(200);
		const { carrier } = (await response.json()) as { carrier: Carrier };
		expect(carrier.certification).toMatchObject({
			state: "valid",
			driftedKeys: [],
			issuedByEmail: "admin@example.com",
		});
		expect(carrier.certification?.certificateNumber).toMatch(
			/^AW1-\d{4}-[2-9A-HJ-NP-Z]{6}$/,
		);

		expect(await publicCertificate()).toMatchObject({
			certificateNumber: carrier.certification?.certificateNumber,
			attested: { headquarters: "NL", apiTraining: false, soc2: 2 },
		});
	});

	test("refuses to certify values the reviewer never saw", async () => {
		await db
			.update(tables.providerClaim)
			.set({ promptLogging: true, iso27001: true })
			.where(eq(tables.providerClaim.id, CLAIM_ID));

		const response = await certify();
		expect(response.status).toBe(409);
		expect(((await response.json()) as { message: string }).message).toBe(
			"The carrier changed its prompt logging policy and ISO 27001 status since you opened the review. Reload and review the new values.",
		);
		expect((await adminCarrier())?.certification).toBeNull();
		expect(await publicCertificate()).toBeNull();
	});

	test("hides the stamp once the carrier changes an attested claim", async () => {
		await certify();
		await db
			.update(tables.providerClaim)
			.set({ promptLogging: true })
			.where(eq(tables.providerClaim.id, CLAIM_ID));

		expect(await publicCertificate()).toBeNull();
		expect((await adminCarrier())?.certification).toMatchObject({
			state: "drifted",
			driftedKeys: ["promptLogging"],
		});
	});

	test("hides an expired certificate", async () => {
		await certify();
		await db
			.update(tables.providerCertification)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(tables.providerCertification.providerId, CARRIER_ID));

		expect(await publicCertificate()).toBeNull();
		expect((await adminCarrier())?.certification?.state).toBe("expired");
	});

	test("re-certifying supersedes the previous certificate", async () => {
		const first = ((await (await certify()).json()) as { carrier: Carrier })
			.carrier.certification;
		const second = ((await (await certify()).json()) as { carrier: Carrier })
			.carrier;

		expect(second.certification?.certificateNumber).not.toBe(
			first?.certificateNumber,
		);
		expect(second.history).toEqual([
			expect.objectContaining({
				certificateNumber: first?.certificateNumber,
				revokeReason: `Superseded by ${second.certification?.certificateNumber}`,
			}),
		]);
		const active = await db.query.providerCertification.findMany({
			where: { providerId: { eq: CARRIER_ID }, status: { eq: "active" } },
		});
		expect(active).toHaveLength(1);
	});

	test("revoking removes the stamp, and a second revoke conflicts", async () => {
		const { carrier } = (await (await certify()).json()) as {
			carrier: Carrier;
		};
		const id = carrier.certification?.id ?? "";

		const response = await revoke(id);
		expect(response.status).toBe(200);
		expect(
			((await response.json()) as { carrier: Carrier }).carrier.certification,
		).toBeNull();
		expect(await publicCertificate()).toBeNull();

		expect((await revoke(id)).status).toBe(409);
	});

	test("read-only admins can list but not certify", async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "";
		process.env.ADMIN_VIEWER_EMAILS = "admin@example.com";

		expect(await adminCarrier()).toBeDefined();
		expect((await certify()).status).toBe(403);
		expect(await publicCertificate()).toBeNull();
	});
});
