import { execFileSync } from "node:child_process";
import dns from "node:dns/promises";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";

import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";
import { getApiKeyFingerprint } from "@llmgateway/shared/api-key-hash";

const orgId = "self-serve-sso-org";
const providerId = "self-serve-test-idp";
let cookie: string;
let cert: string;
let scratch: string;

async function register() {
	return await app.request("/sso/providers", {
		method: "POST",
		headers: { Cookie: cookie, "Content-Type": "application/json" },
		body: JSON.stringify({
			organizationId: orgId,
			providerId,
			domain: "victim.example.test",
			providerType: "entra",
			entryPoint:
				"https://login.microsoftonline.com/00000000-0000-4000-8000-000000000000/saml2",
			cert,
		}),
	});
}

async function provider() {
	return await db.query.ssoProvider.findFirst({
		where: { providerId: { eq: providerId } },
	});
}

describe("self-serve SSO domain ownership", () => {
	beforeAll(() => {
		mkdirSync(".context", { recursive: true });
		scratch = mkdtempSync(join(".context", "sso-domain-"));
		const certPath = join(scratch, "cert.pem");
		execFileSync(
			"openssl",
			[
				"req",
				"-x509",
				"-newkey",
				"rsa:2048",
				"-nodes",
				"-keyout",
				join(scratch, "key.pem"),
				"-out",
				certPath,
				"-days",
				"1",
				"-subj",
				"/CN=idp.example.test",
			],
			{ stdio: "ignore" },
		);
		cert = readFileSync(certPath, "utf8");
	});
	afterAll(() => {
		rmSync(scratch, { recursive: true, force: true });
	});
	beforeEach(async () => {
		vi.stubEnv("SSO_ENABLED", "true");
		cookie = await createTestUser();
		await db.insert(tables.organization).values({
			id: orgId,
			name: "Test Organization",
			billingEmail: "admin@example.com",
			plan: "pro",
			proSeats: 3,
			proSsoEnabled: true,
			proScimEnabled: true,
		});
		await db
			.insert(tables.userOrganization)
			.values({ userId: "test-user-id", organizationId: orgId, role: "owner" });
	});
	afterEach(async () => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		syncBuiltinESMExports();
		await deleteAll();
	});

	it("does not equate paid organization administration with domain ownership", async () => {
		const response = await register();
		expect(response.status).toBe(201);
		expect((await provider())?.domainVerified).toBe(false);
	});

	it("requires new proof after a verified connection changes domains", async () => {
		expect((await register()).status).toBe(201);
		await db
			.update(tables.ssoProvider)
			.set({ domainVerified: true })
			.where(eq(tables.ssoProvider.providerId, providerId));
		const response = await app.request(`/sso/providers/${providerId}`, {
			method: "PATCH",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({
				organizationId: orgId,
				domain: "other.example.test",
			}),
		});
		expect(response.status).toBe(200);
		expect((await provider())?.domainVerified).toBe(false);
	});

	it("does not let an unverified domain claim disable a victim's password login", async () => {
		expect((await register()).status).toBe(201);
		await db
			.update(tables.ssoProvider)
			.set({ domainVerified: false, enforced: true })
			.where(eq(tables.ssoProvider.providerId, providerId));
		await db.insert(tables.user).values({
			id: "domain-victim-user",
			name: "Test User",
			email: "user@victim.example.test",
			emailVerified: true,
		});
		const account = await db.query.account.findFirst({
			where: {
				userId: { eq: "test-user-id" },
				providerId: { eq: "credential" },
			},
		});
		await db.insert(tables.account).values({
			userId: "domain-victim-user",
			accountId: "domain-victim-user",
			providerId: "credential",
			password: account!.password,
		});
		const response = await app.request("/auth/sign-in/email", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				email: "user@victim.example.test",
				password: "admin@example.com1A",
			}),
		});
		expect(response.status).toBe(200);
	});
	it("rejects foreign SCIM identities before creating users or accepting another organization's invites", async () => {
		expect((await register()).status).toBe(201);
		await db
			.update(tables.ssoProvider)
			.set({ domain: "owned.example.test", domainVerified: true })
			.where(eq(tables.ssoProvider.providerId, providerId));
		const connection = await provider();
		await db.insert(tables.user).values({
			id: "inviting-org-owner",
			name: "Test Owner",
			email: "owner@invite.example.test",
			emailVerified: true,
		});
		await db.insert(tables.organization).values({
			id: "invite-target-org",
			name: "Test Organization",
			billingEmail: "owner@invite.example.test",
		});
		await db.insert(tables.userOrganization).values({
			organizationId: "invite-target-org",
			userId: "inviting-org-owner",
			role: "owner",
		});
		await db.insert(tables.organizationInvite).values({
			organizationId: "invite-target-org",
			invitedBy: "inviting-org-owner",
			role: "owner",
			email: "new-user@other.example.test",
			expiresAt: new Date(Date.now() + 60000),
		});
		await db.insert(tables.scimToken).values({
			organizationId: orgId,
			ssoProviderId: connection!.id,
			tokenHash: getApiKeyFingerprint("test-domain-scim-token"),
			maskedToken: "test-token",
			createdBy: "test-user-id",
		});
		const response = await app.request("/scim/v2/Users", {
			method: "POST",
			headers: {
				Authorization: "Bearer test-domain-scim-token",
				"Content-Type": "application/scim+json",
			},
			body: JSON.stringify({
				userName: "new-user@other.example.test",
				active: true,
			}),
		});
		expect(response.status).toBe(403);
		expect(
			await db.query.user.findFirst({
				where: { email: { eq: "new-user@other.example.test" } },
			}),
		).toBeUndefined();
		expect(
			(
				await db.query.organizationInvite.findFirst({
					where: { email: { eq: "new-user@other.example.test" } },
				})
			)?.status,
		).toBe("pending");
		const legitimate = await app.request("/scim/v2/Users", {
			method: "POST",
			headers: {
				Authorization: "Bearer test-domain-scim-token",
				"Content-Type": "application/scim+json",
			},
			body: JSON.stringify({
				userName: "employee@owned.example.test",
				active: true,
			}),
		});
		expect(legitimate.status).toBe(201);
	});
	it("requires DNS proof for every domain before allowing SSO enforcement", async () => {
		expect((await register()).status).toBe(201);
		await db
			.update(tables.ssoProvider)
			.set({
				domain: "owned.example.test,staff.example.test",
				domainVerified: false,
			})
			.where(eq(tables.ssoProvider.providerId, providerId));
		const headers = { Cookie: cookie, "Content-Type": "application/json" };
		const challenge = await app.request(
			`/sso/providers/${providerId}/verification`,
			{
				method: "POST",
				headers,
				body: JSON.stringify({ organizationId: orgId }),
			},
		);
		expect(challenge.status).toBe(201);
		const { records } = (await challenge.json()) as {
			records: { name: string; value: string }[];
		};
		expect(records).toHaveLength(2);
		const resolveTxt = vi
			.spyOn(dns, "resolveTxt")
			.mockImplementation(async (name) =>
				name === records[0].name ? [[records[0].value]] : [],
			);
		syncBuiltinESMExports();
		const verify = () =>
			app.request(`/sso/providers/${providerId}/verify-domain`, {
				method: "POST",
				headers,
				body: JSON.stringify({ organizationId: orgId }),
			});
		expect((await verify()).status).toBe(502);
		expect((await provider())?.domainVerified).toBe(false);
		resolveTxt.mockImplementation(async (name) => {
			const record = records.find((record) => record.name === name);
			return record ? [[record.value]] : [];
		});
		expect((await verify()).status).toBe(200);
		expect((await provider())?.domainVerified).toBe(true);
		const enforce = await app.request(`/sso/providers/${providerId}`, {
			method: "PATCH",
			headers,
			body: JSON.stringify({ organizationId: orgId, enforced: true }),
		});
		expect(enforce.status).toBe(200);
	});
	it("keeps DNS challenge management scoped to the connection organization", async () => {
		expect((await register()).status).toBe(201);
		const response = await app.request(
			`/sso/providers/${providerId}/verification`,
			{
				method: "POST",
				headers: { Cookie: cookie, "Content-Type": "application/json" },
				body: JSON.stringify({ organizationId: "foreign-org" }),
			},
		);
		expect(response.status).toBe(403);
	});
	it("does not let a pending domain claim shadow an already verified connection", async () => {
		expect((await register()).status).toBe(201);
		const pending = await provider();
		await db
			.update(tables.ssoProvider)
			.set({ domainVerified: false })
			.where(eq(tables.ssoProvider.providerId, providerId));
		await db.insert(tables.user).values({
			id: "verified-domain-owner",
			name: "Test Owner",
			email: "owner@victim.example.test",
			emailVerified: true,
		});
		await db.insert(tables.organization).values({
			id: "verified-domain-org",
			name: "Test Organization",
			billingEmail: "owner@victim.example.test",
			plan: "enterprise",
		});
		await db.insert(tables.userOrganization).values({
			organizationId: "verified-domain-org",
			userId: "verified-domain-owner",
			role: "owner",
		});
		const verifiedId = "verified-domain-idp";
		await db.insert(tables.ssoProvider).values({
			providerId: verifiedId,
			userId: "verified-domain-owner",
			organizationId: "verified-domain-org",
			domain: "victim.example.test",
			domainVerified: true,
			issuer: pending!.issuer.replaceAll(providerId, verifiedId),
			samlConfig: pending!.samlConfig!.replaceAll(providerId, verifiedId),
		});
		const response = await app.request("/auth/sign-in/sso", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				email: "user@victim.example.test",
				callbackURL: `${process.env.UI_URL ?? "http://localhost:3002"}/dashboard`,
			}),
		});
		expect(response.status).toBe(200);
	});
	it("does not verify a domain that changed while DNS was being checked", async () => {
		expect((await register()).status).toBe(201);
		const headers = { Cookie: cookie, "Content-Type": "application/json" };
		const response = await app.request(
			`/sso/providers/${providerId}/verification`,
			{
				method: "POST",
				headers,
				body: JSON.stringify({ organizationId: orgId }),
			},
		);
		expect(response.status).toBe(201);
		const { records } = (await response.json()) as {
			records: { name: string; value: string }[];
		};
		let changed = false;
		vi.spyOn(dns, "resolveTxt").mockImplementation(async () => {
			if (!changed) {
				changed = true;
				await db
					.update(tables.ssoProvider)
					.set({ domain: "changed.example.test" })
					.where(eq(tables.ssoProvider.providerId, providerId));
			}
			return [[records[0].value]];
		});
		syncBuiltinESMExports();
		const verify = await app.request(
			`/sso/providers/${providerId}/verify-domain`,
			{
				method: "POST",
				headers,
				body: JSON.stringify({ organizationId: orgId }),
			},
		);
		expect(changed).toBe(true);
		expect(verify.status).toBe(409);
		expect(await provider()).toMatchObject({
			domain: "changed.example.test",
			domainVerified: false,
		});
	});
});
