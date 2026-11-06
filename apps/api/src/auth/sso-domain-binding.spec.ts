import { generateKeyPairSync, sign } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";

import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "vitest";

import { apiAuth } from "@/auth/config.js";
import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

const orgId = "oidc-domain-org";
const providerId = "test-domain-oidc";
const clientId = "test-sso-client";
const { publicKey, privateKey } = generateKeyPairSync("rsa", {
	modulusLength: 2048,
});
const jwk = {
	...publicKey.export({ format: "jwk" }),
	kid: "test-identity-key",
	use: "sig",
	alg: "RS256",
};
let issuer: string;
let assertedEmail: string;
let nonce: string | null;
let server: Server;
let origins: string[];
let configuredOrigins: string[];

function idToken() {
	const now = Math.floor(Date.now() / 1000);
	const header = Buffer.from(
		JSON.stringify({ alg: "RS256", typ: "JWT", kid: jwk.kid }),
	).toString("base64url");
	const claims = Buffer.from(
		JSON.stringify({
			iss: issuer,
			aud: clientId,
			sub: `identity-${assertedEmail}`,
			email: assertedEmail,
			email_verified: true,
			name: "Test User",
			iat: now,
			exp: now + 60,
			...(nonce ? { nonce } : {}),
		}),
	).toString("base64url");
	const payload = `${header}.${claims}`;
	return `${payload}.${sign("RSA-SHA256", Buffer.from(payload), privateKey).toString("base64url")}`;
}

async function login(email: string) {
	assertedEmail = email;
	const start = await app.request("/auth/sign-in/sso", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			providerId,
			providerType: "oidc",
			callbackURL: `${process.env.UI_URL ?? "http://localhost:3002"}/dashboard`,
		}),
	});
	expect(start.status, await start.clone().text()).toBe(200);
	const authorization = new URL(((await start.json()) as { url: string }).url);
	nonce = authorization.searchParams.get("nonce");
	const cookie = start.headers
		.getSetCookie()
		.map((value) => value.split(";")[0])
		.join(";");
	return await app.request(
		`/auth/sso/callback/${providerId}?code=test-code&state=${encodeURIComponent(authorization.searchParams.get("state")!)}`,
		{ headers: { Cookie: cookie } },
	);
}

describe("verified SSO identity domain binding", () => {
	beforeAll(async () => {
		server = createServer(async (req, res) => {
			for await (const _chunk of req) {
				/* Consume the token form. */
			}
			res.setHeader("Content-Type", "application/json");
			if (req.url === "/jwks") {
				res.end(JSON.stringify({ keys: [jwk] }));
			} else if (req.url === "/token") {
				res.end(
					JSON.stringify({
						access_token: "test-access-token",
						token_type: "Bearer",
						expires_in: 60,
						id_token: idToken(),
					}),
				);
			} else if (req.url === "/userinfo") {
				res.end(
					JSON.stringify({
						sub: `identity-${assertedEmail}`,
						email: assertedEmail,
						email_verified: true,
						name: "Test User",
					}),
				);
			} else {
				res.statusCode = 404;
				res.end("{}");
			}
		});
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("No local IdP port");
		}
		issuer = `http://127.0.0.1:${address.port}`;
		const context = await apiAuth.$context;
		origins = [...context.trustedOrigins];
		context.trustedOrigins.push(issuer);
		if (!Array.isArray(apiAuth.options.trustedOrigins)) {
			throw new Error("Expected static test origins");
		}
		configuredOrigins = [...apiAuth.options.trustedOrigins];
		apiAuth.options.trustedOrigins.push(issuer);
	});
	afterAll(async () => {
		(await apiAuth.$context).trustedOrigins.splice(0, Infinity, ...origins);
		if (Array.isArray(apiAuth.options.trustedOrigins)) {
			apiAuth.options.trustedOrigins.splice(0, Infinity, ...configuredOrigins);
		}
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});
	beforeEach(async () => {
		await createTestUser();
		await db.insert(tables.organization).values({
			id: orgId,
			name: "Test Organization",
			billingEmail: "admin@example.com",
			plan: "pro",
			proSeats: 3,
			proSsoEnabled: true,
		});
		await db
			.insert(tables.userOrganization)
			.values({ userId: "test-user-id", organizationId: orgId, role: "owner" });
		await db.insert(tables.ssoProvider).values({
			providerId,
			userId: "test-user-id",
			organizationId: orgId,
			issuer,
			domain: "owned.example.test",
			domainVerified: true,
			oidcConfig: JSON.stringify({
				issuer,
				clientId,
				clientSecret: "test-client-secret",
				authorizationEndpoint: `${issuer}/authorize`,
				tokenEndpoint: `${issuer}/token`,
				jwksEndpoint: `${issuer}/jwks`,
				userInfoEndpoint: `${issuer}/userinfo`,
				scopes: ["openid", "email"],
				pkce: false,
			}),
		});
	});
	afterEach(deleteAll);

	it("rejects a foreign email before user creation and cross-organization invite acceptance", async () => {
		await db.insert(tables.user).values({
			id: "other-org-owner",
			name: "Test Owner",
			email: "owner@other.example.test",
			emailVerified: true,
		});
		await db.insert(tables.organization).values({
			id: "other-domain-org",
			name: "Test Organization",
			billingEmail: "owner@other.example.test",
		});
		await db.insert(tables.userOrganization).values({
			userId: "other-org-owner",
			organizationId: "other-domain-org",
			role: "owner",
		});
		await db.insert(tables.organizationInvite).values({
			organizationId: "other-domain-org",
			invitedBy: "other-org-owner",
			email: "new-user@foreign.example.test",
			role: "owner",
			expiresAt: new Date(Date.now() + 60000),
		});
		const response = await login("new-user@foreign.example.test");
		expect(response.status).toBe(302);
		expect(
			new URL(response.headers.get("location")!).searchParams.get("error"),
		).toBe("sso_email_domain_mismatch");
		expect(
			await db.query.user.findFirst({
				where: { email: { eq: "new-user@foreign.example.test" } },
			}),
		).toBeUndefined();
		expect(
			(
				await db.query.organizationInvite.findFirst({
					where: { email: { eq: "new-user@foreign.example.test" } },
				})
			)?.status,
		).toBe("pending");
	});

	it("does not reuse an old provider account to authenticate an identity outside the verified domain", async () => {
		await db.insert(tables.user).values({
			id: "old-provider-victim",
			name: "Test User",
			email: "victim@foreign.example.test",
			emailVerified: true,
		});
		await db.insert(tables.account).values({
			providerId,
			accountId: "identity-user@owned.example.test",
			userId: "old-provider-victim",
		});
		const response = await login("user@owned.example.test");
		expect(response.status).toBe(302);
		expect(
			new URL(response.headers.get("location")!).searchParams.get("error"),
		).toBe("sso_email_domain_mismatch");
		expect(
			await db.query.session.findFirst({
				where: { userId: { eq: "old-provider-victim" } },
			}),
		).toBeUndefined();
		expect(
			(
				await db.query.account.findFirst({
					where: { providerId: { eq: providerId } },
				})
			)?.userId,
		).toBe("old-provider-victim");
	});
	it("links an existing verified-domain identity and joins only its connection organization", async () => {
		await db.insert(tables.user).values({
			id: "legitimate-sso-user",
			name: "Test User",
			email: "user@owned.example.test",
			emailVerified: true,
		});
		const response = await login("user@owned.example.test");
		expect(response.status).toBe(302);
		expect(
			new URL(response.headers.get("location")!).searchParams.has("error"),
		).toBe(false);
		expect(
			await db.query.account.findFirst({
				where: {
					providerId: { eq: providerId },
					userId: { eq: "legitimate-sso-user" },
				},
			}),
		).toBeDefined();
		expect(
			await db.query.userOrganization.findFirst({
				where: {
					organizationId: { eq: orgId },
					userId: { eq: "legitimate-sso-user" },
				},
			}),
		).toBeDefined();
	});
});
