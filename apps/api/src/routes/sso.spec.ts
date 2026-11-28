import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

const ORGANIZATION_ID = "sso-domain-claim-org";
const OTHER_ORGANIZATION_ID = "sso-domain-claim-other-org";

describe("sso provider domains", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();
		await db.insert(tables.organization).values([
			{
				id: ORGANIZATION_ID,
				name: "SSO Domain Claim Org",
				billingEmail: "claim@example.com",
				plan: "enterprise",
			},
			{
				id: OTHER_ORGANIZATION_ID,
				name: "Other SSO Domain Claim Org",
				billingEmail: "other-claim@example.com",
				plan: "enterprise",
				ssoAutoJoinDomain: "autojoin.example.org",
			},
		]);
		await db.insert(tables.userOrganization).values({
			userId: "test-user-id",
			organizationId: ORGANIZATION_ID,
			role: "owner",
		});
		await db.insert(tables.ssoProvider).values({
			issuer: "https://idp.example.org",
			domain: "first.example.org,victim.example.org",
			providerId: "sso-domain-claim-other",
			organizationId: OTHER_ORGANIZATION_ID,
			enforced: true,
			domainVerified: true,
		});
	});

	afterEach(async () => {
		await deleteAll();
	});

	async function request(
		path: string,
		method: "POST" | "PATCH",
		body: unknown,
	) {
		return await app.request(path, {
			method,
			headers: { Cookie: token, "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	}

	function register(domain: string) {
		return request("/sso/providers", "POST", {
			organizationId: ORGANIZATION_ID,
			providerId: "sso-domain-claim",
			providerType: "generic",
			domain,
			entryPoint: "https://idp.example.com/sso/saml",
			cert: "MIIC",
			enforced: true,
		});
	}

	test.each(["gmail.com", "acme.example.com, Outlook.com"])(
		"rejects a public email domain on register (%s)",
		async (domain) => {
			expect((await register(domain)).status).toBe(400);
		},
	);

	test.each(["co.uk", "acme.example.com,github.io", "com.au"])(
		"rejects a public suffix on register (%s)",
		async (domain) => {
			expect((await register(domain)).status).toBe(400);
		},
	);

	test.each([
		"victim.example.org",
		"acme.example.com,VICTIM.example.org",
		"autojoin.example.org",
		"example.org",
		"eu.victim.example.org",
		"sub.autojoin.example.org",
	])(
		"rejects a domain claimed by another organization on register (%s)",
		async (domain) => {
			expect((await register(domain)).status).toBe(409);
			const own = await db.query.ssoProvider.findFirst({
				where: { organizationId: { eq: ORGANIZATION_ID } },
			});
			expect(own).toBeUndefined();
		},
	);

	test("rejects changing the domain to one claimed by another organization", async () => {
		await db.insert(tables.ssoProvider).values({
			issuer: "https://idp.example.com",
			domain: "acme.example.com",
			providerId: "sso-domain-claim",
			organizationId: ORGANIZATION_ID,
			domainVerified: true,
		});
		const update = (domain: string) =>
			request("/sso/providers/sso-domain-claim", "PATCH", {
				organizationId: ORGANIZATION_ID,
				domain,
			});

		expect((await update("acme.example.com,victim.example.org")).status).toBe(
			409,
		);
		expect((await update("gmail.com")).status).toBe(400);
		const own = await db.query.ssoProvider.findFirst({
			where: { providerId: { eq: "sso-domain-claim" } },
			columns: { domain: true },
		});
		expect(own?.domain).toBe("acme.example.com");

		expect(
			(await update("acme.example.com,docs.acme.example.com")).status,
		).toBe(200);
		expect((await update("sibling.example.org")).status).toBe(200);
	});

	test("ignores claims held by deleted organizations", async () => {
		await db.insert(tables.ssoProvider).values({
			issuer: "https://idp.example.com",
			domain: "acme.example.com",
			providerId: "sso-domain-claim",
			organizationId: ORGANIZATION_ID,
			domainVerified: true,
		});
		await db
			.update(tables.organization)
			.set({ status: "deleted" })
			.where(eq(tables.organization.id, OTHER_ORGANIZATION_ID));

		const response = await request("/sso/providers/sso-domain-claim", "PATCH", {
			organizationId: ORGANIZATION_ID,
			domain: "victim.example.org,autojoin.example.org",
		});
		expect(response.status).toBe(200);
	});
});
