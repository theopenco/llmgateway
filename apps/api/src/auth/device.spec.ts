import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { db, eq, tables } from "@llmgateway/db";

import { apiAuth } from "./config.js";

const apiUrl = process.env.API_URL ?? "http://localhost:4002";
const uiUrl = process.env.UI_URL ?? "http://localhost:3002";
const userId = "device-test-user";
const browserToken = "device-test-browser-session";

async function request(route: string, body?: object, token?: string) {
	return await apiAuth.handler(
		new Request(`${apiUrl}/auth${route}`, {
			method: body ? "POST" : "GET",
			headers: {
				"Content-Type": "application/json",
				Origin: uiUrl,
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
			...(body ? { body: JSON.stringify(body) } : {}),
		}),
	);
}

async function start() {
	const response = await request("/device/code", {
		client_id: "llmgateway-cli",
	});
	expect(response.status).toBe(200);
	return await (response.json() as Promise<{
		device_code: string;
		user_code: string;
		verification_uri: string;
		verification_uri_complete: string;
		expires_in: number;
		interval: number;
	}>);
}

async function poll(deviceCode: string) {
	return await request("/device/token", {
		client_id: "llmgateway-cli",
		device_code: deviceCode,
		grant_type: "urn:ietf:params:oauth:grant-type:device_code",
	});
}

async function approve(userCode: string) {
	expect(
		(await request(`/device?user_code=${userCode}`, undefined, browserToken))
			.status,
	).toBe(200);
	expect(
		(await request("/device/approve", { userCode }, browserToken)).status,
	).toBe(200);
}

describe("CLI device authorization", () => {
	afterEach(() => vi.unstubAllEnvs());
	beforeEach(async () => {
		vi.unstubAllEnvs();
		await db.delete(tables.deviceCode);
		await db.delete(tables.userOrganization);
		await db.delete(tables.project);
		await db.delete(tables.account);
		await db.delete(tables.organization);
		await db.delete(tables.user);
		await db.insert(tables.user).values({
			id: userId,
			name: "Device Test",
			email: "device@example.com",
			emailVerified: true,
		});
		await db.insert(tables.session).values({
			token: browserToken,
			userId,
			expiresAt: new Date(Date.now() + 60_000),
		});
	});

	test("requires explicit browser approval, returns a usable bearer session, and consumes the code once", async () => {
		const code = await start();
		expect(code.verification_uri).toBe(`${uiUrl}/connect/device`);
		expect(
			new URL(code.verification_uri_complete).searchParams.get("user_code"),
		).toBe(code.user_code);
		expect(code.expires_in).toBe(600);
		expect(code.interval).toBe(5);
		expect(await (await poll(code.device_code)).json()).toMatchObject({
			error: "authorization_pending",
		});
		expect(
			(await request("/device/approve", { userCode: code.user_code })).status,
		).toBe(401);
		await approve(code.user_code);
		// Move the last poll beyond the server interval without sleeping the suite.
		await db
			.update(tables.deviceCode)
			.set({ lastPolledAt: new Date(Date.now() - 10_000) })
			.where(eq(tables.deviceCode.deviceCode, code.device_code));
		const response = await poll(code.device_code);
		expect(response.status).toBe(200);
		const token = (await response.json()) as {
			access_token: string;
			token_type: string;
		};
		expect(token.token_type.toLowerCase()).toBe("bearer");
		expect(token.access_token).not.toBe(browserToken);
		expect(
			await (
				await request("/get-session", undefined, token.access_token)
			).json(),
		).toMatchObject({ user: { id: userId } });
		expect(await (await poll(code.device_code)).json()).toMatchObject({
			error: "invalid_grant",
		});
		expect((await request("/sign-out", {}, token.access_token)).status).toBe(
			200,
		);
		expect(
			await (
				await request("/get-session", undefined, token.access_token)
			).json(),
		).toBeNull();
		// Signing the CLI out does not revoke the browser's independent session.
		expect(
			await (await request("/get-session", undefined, browserToken)).json(),
		).toMatchObject({ user: { id: userId } });
	});

	test("a bearer session takes precedence over a browser cookie", async () => {
		const browser = await request("/get-session", undefined, browserToken);
		const cookie = browser.headers
			.getSetCookie()
			.map((value) => value.split(";")[0])
			.join("; ");
		expect(cookie).toContain("session_token=");
		const session = async (token?: string) =>
			await apiAuth.api.getSession({
				headers: new Headers({
					Cookie: cookie,
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				}),
			});
		expect(await session()).toMatchObject({ user: { id: userId } });
		const otherId = randomUUID();
		const otherToken = randomUUID();
		await db
			.insert(tables.user)
			.values({ id: otherId, email: "bearer@example.com" });
		await db.insert(tables.session).values({
			token: otherToken,
			userId: otherId,
			expiresAt: new Date(Date.now() + 60_000),
		});
		expect(await session(otherToken)).toMatchObject({ user: { id: otherId } });
		expect(await session("unknown-session")).toBeNull();
	});

	test("rejects unknown clients and slows down premature polling", async () => {
		expect(
			(await request("/device/code", { client_id: "untrusted" })).status,
		).toBe(400);
		const code = await start();
		await poll(code.device_code);
		expect(await (await poll(code.device_code)).json()).toMatchObject({
			error: "slow_down",
		});
	});

	test("denied and expired codes never issue sessions", async () => {
		const denied = await start();
		await request(
			`/device?user_code=${denied.user_code}`,
			undefined,
			browserToken,
		);
		expect(
			(
				await request(
					"/device/deny",
					{ userCode: denied.user_code },
					browserToken,
				)
			).status,
		).toBe(200);
		expect(await (await poll(denied.device_code)).json()).toMatchObject({
			error: "access_denied",
		});
		const expired = await start();
		await db
			.update(tables.deviceCode)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(tables.deviceCode.deviceCode, expired.device_code));
		expect(await (await poll(expired.device_code)).json()).toMatchObject({
			error: "expired_token",
		});
	});

	test("another user cannot approve a code claimed by the browser", async () => {
		const code = await start();
		await request(
			`/device?user_code=${code.user_code}`,
			undefined,
			browserToken,
		);
		const otherId = randomUUID();
		const otherToken = randomUUID();
		await db
			.insert(tables.user)
			.values({ id: otherId, email: "other@example.com" });
		await db.insert(tables.session).values({
			token: otherToken,
			userId: otherId,
			expiresAt: new Date(Date.now() + 60_000),
		});
		expect(
			(
				await request(
					"/device/approve",
					{ userCode: code.user_code },
					otherToken,
				)
			).status,
		).toBe(403);
		expect(await (await poll(code.device_code)).json()).toMatchObject({
			error: "authorization_pending",
		});
	});

	test("an approved request cannot reactivate a deactivated account", async () => {
		const code = await start();
		await approve(code.user_code);
		await db
			.update(tables.user)
			.set({ status: "deactivated" })
			.where(eq(tables.user.id, userId));
		expect((await poll(code.device_code)).status).toBe(403);
		expect(
			await db.query.session.findMany({ where: { userId: { eq: userId } } }),
		).toHaveLength(0);
	});

	test("SSO-enforced users can authorize the CLI with an existing session but cannot sign in with a password", async () => {
		vi.stubEnv("SSO_ENABLED", "true");
		vi.stubEnv("HOSTED", "true");
		const [org] = await db
			.insert(tables.organization)
			.values({
				name: "Device SSO Test",
				billingEmail: "billing@example.com",
				plan: "enterprise",
			})
			.returning();
		await db.insert(tables.ssoProvider).values({
			issuer: "https://idp.example.com",
			domain: "example.com",
			providerId: "device-sso",
			organizationId: org.id,
			enforced: true,
			domainVerified: true,
		});
		expect(
			(
				await request("/sign-in/email", {
					email: "device@example.com",
					password: "Password123!",
				})
			).status,
		).toBe(403);
		const code = await start();
		await approve(code.user_code);
		const response = await poll(code.device_code);
		expect(response.status).toBe(200);
		const token = (await response.json()) as { access_token: string };
		expect(
			await (
				await request("/get-session", undefined, token.access_token)
			).json(),
		).toMatchObject({ user: { id: userId } });
	});
});
