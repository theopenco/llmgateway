import * as crypto from "better-auth/crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiAuth, redisClient } from "@/auth/config.js";
import { app } from "@/index.js";
import {
	getEmailChangeRateLimitKeys,
	getEmailChangeProofRateLimitKeys,
} from "@/lib/email-change.js";
import { createTestUser, deleteAll } from "@/testing.js";
import * as abuseIp from "@/utils/abuse-ip.js";
import * as email from "@/utils/email.js";

import { db, eq, sql, tables } from "@llmgateway/db";

vi.mock("better-auth/crypto", async (importOriginal) => ({
	...(await importOriginal<typeof crypto>()),
}));

const currentPassword = "admin@example.com1A";
const newEmail = "changed@example.com";
const sendEmail = vi.spyOn(email, "sendTransactionalEmail");
const checkIp = vi.spyOn(abuseIp, "checkIpAbuse");
const rateLimitKeys = new Set<string>();
let cookie: string;

function patch(
	body: Record<string, unknown>,
	session = cookie,
	userId = "test-user-id",
	headers: Record<string, string> = {},
) {
	if (typeof body.email === "string") {
		for (const key of [
			...getEmailChangeRateLimitKeys(userId, body.email),
			...getEmailChangeProofRateLimitKeys(userId, new Headers(headers)),
		]) {
			rateLimitKeys.add(key);
		}
	}
	return app.request("/user/me", {
		method: "PATCH",
		headers: {
			Cookie: session,
			"Content-Type": "application/json",
			...headers,
		},
		body: JSON.stringify(body),
	});
}

function confirm(token: string, headers: Record<string, string> = {}) {
	return app.request("/user/email/confirm", {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: JSON.stringify({ token }),
	});
}

function confirmationToken() {
	const message = sendEmail.mock.calls
		.slice()
		.reverse()
		.find(
			([message]) => message.subject === "Confirm your new LLM Gateway email",
		)?.[0];
	expect(message?.text).toBeDefined();
	const token = message!.text!.match(/#([a-f0-9]{64})/)?.[1];
	expect(token).toBeDefined();
	return token!;
}

function signIn(address: string) {
	return app.request("/auth/sign-in/email", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email: address, password: currentPassword }),
	});
}

async function storedUser() {
	return await db.query.user.findFirst({ where: { id: "test-user-id" } });
}

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

async function waitForDatabaseLock() {
	await vi.waitFor(
		async () => {
			const waiting =
				await db.execute(sql`select count(*)::int as count from pg_stat_activity
			where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid()`);
			expect(waiting.rows[0]?.count).toBeGreaterThan(0);
		},
		{ timeout: 5000 },
	);
}

async function requestReset() {
	const response = await app.request("/auth/request-password-reset", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email: "admin@example.com" }),
	});
	expect(response.status).toBe(200);
	expect((await response.json()).status).toBe(true);
	const record = await db.query.verification.findFirst({
		where: { value: "test-user-id" },
	});
	return record!.identifier.slice("reset-password:".length);
}

function resetPassword(token: string, newPassword = "new-test-password1A") {
	return app.request("/auth/reset-password", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ token, newPassword }),
	});
}

describe("email change confirmation", () => {
	beforeEach(async () => {
		sendEmail.mockReset().mockResolvedValue();
		checkIp.mockReset().mockResolvedValue(null);
		cookie = await createTestUser();
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
		if (rateLimitKeys.size) {
			await redisClient.del(...rateLimitKeys);
			rateLimitKeys.clear();
		}
		await deleteAll();
	});

	it("requires a session and the current password", async () => {
		expect((await patch({ email: newEmail }, "")).status).toBe(401);
		expect((await patch({ email: newEmail })).status).toBe(400);
		expect(
			(await patch({ email: newEmail, currentPassword: "incorrect" })).status,
		).toBe(401);
		expect((await storedUser())?.email).toBe("admin@example.com");
		expect(sendEmail).not.toHaveBeenCalled();
	});

	it("keeps sign-in and password recovery at the old address until confirmation", async () => {
		expect((await patch({ email: newEmail, currentPassword })).status).toBe(
			200,
		);
		expect((await storedUser())?.email).toBe("admin@example.com");
		expect((await storedUser())?.emailVerified).toBe(true);
		expect(sendEmail.mock.calls.map(([message]) => message.to)).toEqual([
			"admin@example.com",
			newEmail,
		]);
		expect((await signIn("admin@example.com")).status).toBe(200);
		expect((await signIn(newEmail)).status).toBe(401);
		for (const address of [newEmail, "admin@example.com"]) {
			await app.request("/auth/request-password-reset", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ email: address }),
			});
		}
		const resetMessages = sendEmail.mock.calls.filter(
			([message]) => message.subject === "Reset your LLM Gateway password",
		);
		expect(resetMessages.map(([message]) => message.to)).toEqual([
			"admin@example.com",
		]);
	});

	it("confirms once, verifies the new address, and revokes every session", async () => {
		await patch({ email: newEmail, currentPassword });
		const token = confirmationToken();
		const pending = await db.query.verification.findFirst({
			where: { id: "email-change:test-user-id" },
		});
		expect(JSON.stringify(pending)).not.toContain(token);
		await signIn("admin@example.com");
		expect((await confirm(token)).status).toBe(200);
		expect((await storedUser())?.email).toBe(newEmail);
		expect((await storedUser())?.emailVerified).toBe(true);
		expect(
			await db.query.session.findMany({ where: { userId: "test-user-id" } }),
		).toHaveLength(0);
		expect(
			(await app.request("/user/me", { headers: { Cookie: cookie } })).status,
		).toBe(401);
		expect((await confirm(token)).status).toBe(400);
		expect((await signIn(newEmail)).status).toBe(200);
		expect((await signIn("admin@example.com")).status).toBe(401);
	});

	it("invalidates old-address reset links while preserving unrelated verifications", async () => {
		await app.request("/auth/request-password-reset", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email: "admin@example.com" }),
		});
		const reset = await db.query.verification.findFirst({
			where: { value: "test-user-id" },
		});
		expect(reset?.identifier).toMatch(/^reset-password:/);
		const token = reset!.identifier.slice("reset-password:".length);
		await db.insert(tables.verification).values([
			{
				id: "other-reset",
				identifier: "reset-password:other-reset",
				value: "other-user-id",
				expiresAt: new Date(Date.now() + 60000),
			},
			{
				id: "other-verification",
				identifier: "other-verification",
				value: "test-user-id",
				expiresAt: new Date(Date.now() + 60000),
			},
		]);
		await patch({ email: newEmail, currentPassword });
		expect((await confirm(confirmationToken())).status).toBe(200);
		const response = await app.request("/auth/reset-password", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ token, newPassword: "new-test-password1A" }),
		});
		expect(response.status).toBe(400);
		expect((await signIn(newEmail)).status).toBe(200);
		expect(
			(await db.query.verification.findMany()).map((row) => row.id).sort(),
		).toEqual(["other-reset", "other-verification"]);
	});

	it("serializes an in-flight password reset before email confirmation", async () => {
		const token = await requestReset();
		await patch({ email: newEmail, currentPassword });
		const emailToken = confirmationToken();
		const context = await apiAuth.$context;
		const hash = context.password.hash;
		const entered = deferred();
		const release = deferred();
		const spy = vi
			.spyOn(context.password, "hash")
			.mockImplementationOnce(async (value) => {
				entered.resolve();
				await release.promise;
				return await hash(value);
			});
		const resetting = resetPassword(token);
		await entered.promise;
		const confirming = confirm(emailToken);
		try {
			await waitForDatabaseLock();
			expect(
				await db.query.verification.findFirst({
					where: { identifier: `reset-password:${token}` },
				}),
			).toBeDefined();
		} finally {
			release.resolve();
			await Promise.all([resetting, confirming]);
			spy.mockRestore();
		}
		expect((await resetting).status).toBe(200);
		expect((await confirming).status).toBe(400);
		expect((await storedUser())?.email).toBe("admin@example.com");
	});

	it("serializes email confirmation before an in-flight password reset", async () => {
		const token = await requestReset();
		await patch({ email: newEmail, currentPassword });
		const verify = crypto.verifyPassword;
		const entered = deferred();
		const release = deferred();
		const spy = vi
			.spyOn(crypto, "verifyPassword")
			.mockImplementationOnce(async (value) => {
				entered.resolve();
				await release.promise;
				return await verify(value);
			});
		const confirming = confirm(confirmationToken());
		await entered.promise;
		const resetting = resetPassword(token);
		try {
			await waitForDatabaseLock();
		} finally {
			release.resolve();
			await Promise.all([confirming, resetting]);
			spy.mockRestore();
		}
		expect((await confirming).status).toBe(200);
		expect((await resetting).status).toBe(400);
		expect((await signIn(newEmail)).status).toBe(200);
	});

	it("serializes reset token issuance with email confirmation", async () => {
		await patch({ email: newEmail, currentPassword });
		const emailToken = confirmationToken();
		const context = await apiAuth.$context;
		const create = context.internalAdapter.createVerificationValue;
		const entered = deferred();
		const release = deferred();
		const spy = vi
			.spyOn(context.internalAdapter, "createVerificationValue")
			.mockImplementationOnce(async (...args) => {
				entered.resolve();
				await release.promise;
				return await create(...args);
			});
		const issuing = app.request("/auth/request-password-reset", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email: "admin@example.com" }),
		});
		await entered.promise;
		const confirming = confirm(emailToken);
		try {
			await waitForDatabaseLock();
		} finally {
			release.resolve();
			await Promise.all([issuing, confirming]);
			spy.mockRestore();
		}
		expect((await issuing).status).toBe(200);
		expect((await confirming).status).toBe(200);
		expect(await db.query.verification.findMany()).toHaveLength(0);
	});

	it("releases the user lock before delivering a committed reset token", async () => {
		await patch({ email: newEmail, currentPassword });
		const emailToken = confirmationToken();
		const entered = deferred();
		const release = deferred();
		sendEmail.mockImplementationOnce(async () => {
			entered.resolve();
			await release.promise;
		});
		const issuing = app.request("/auth/request-password-reset", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email: "admin@example.com" }),
		});
		let resetToken: string | undefined;
		try {
			await entered.promise;
			const record = await db.query.verification.findFirst({
				where: { value: "test-user-id" },
			});
			expect(record?.identifier).toMatch(/^reset-password:/);
			resetToken = record!.identifier.slice("reset-password:".length);
			expect((await confirm(emailToken)).status).toBe(200);
			expect((await storedUser())?.email).toBe(newEmail);
		} finally {
			release.resolve();
			await issuing;
		}
		expect((await issuing).status).toBe(200);
		expect((await resetPassword(resetToken!)).status).toBe(400);
		expect((await signIn(newEmail)).status).toBe(200);
	});

	it("removes committed reset tokens when delivery fails and permits retry", async () => {
		sendEmail.mockRejectedValueOnce(new Error("Mail unavailable"));
		const response = await app.request("/auth/request-password-reset", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email: "admin@example.com" }),
		});
		expect(response.status).toBe(500);
		expect(await db.query.verification.findMany()).toHaveLength(0);
		expect((await signIn("admin@example.com")).status).toBe(200);
		expect((await resetPassword(await requestReset())).status).toBe(200);
	});

	it("rolls back consumed reset tokens when the native reset hook fails", async () => {
		const token = await requestReset();
		const context = await apiAuth.$context;
		const options = context.options.emailAndPassword!;
		const original = options.onPasswordReset;
		options.onPasswordReset = async () => {
			throw new Error("Reset hook unavailable");
		};
		try {
			expect((await resetPassword(token)).status).toBe(500);
		} finally {
			options.onPasswordReset = original;
		}
		expect((await signIn("admin@example.com")).status).toBe(200);
		expect((await resetPassword(token)).status).toBe(200);
	});

	it("retains native reset session revocation", async () => {
		const token = await requestReset();
		const context = await apiAuth.$context;
		const options = context.options.emailAndPassword!;
		const original = options.revokeSessionsOnPasswordReset;
		options.revokeSessionsOnPasswordReset = true;
		try {
			const response = await resetPassword(token);
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ status: true });
		} finally {
			options.revokeSessionsOnPasswordReset = original;
		}
		expect(
			await db.query.session.findMany({ where: { userId: "test-user-id" } }),
		).toHaveLength(0);
	});

	it("retains native reset token and password errors", async () => {
		const token = await requestReset();
		for (const [value, password, code] of [
			["", "new-test-password1A", "INVALID_TOKEN"],
			["unknown", "new-test-password1A", "INVALID_TOKEN"],
			[token, "short", "PASSWORD_TOO_SHORT"],
			[token, "a".repeat(129), "PASSWORD_TOO_LONG"],
		]) {
			const response = await resetPassword(value, password);
			expect(response.status).toBe(400);
			expect((await response.json()).code).toBe(code);
		}
		expect((await resetPassword(token)).status).toBe(200);
	});

	it("limits failed password proofs before hashing without consuming mail quota", async () => {
		const context = await apiAuth.$context;
		const verify = vi.spyOn(context.password, "verify");
		try {
			for (let attempt = 0; attempt < 10; attempt++) {
				expect(
					(await patch({ email: newEmail, currentPassword: "incorrect" }))
						.status,
				).toBe(401);
			}
			expect(
				(
					await patch(
						{ email: "another@example.com", currentPassword },
						cookie,
						"test-user-id",
						{ "x-forwarded-for": "198.51.100.10" },
					)
				).status,
			).toBe(429);
			expect(verify).toHaveBeenCalledTimes(10);
		} finally {
			verify.mockRestore();
		}
		for (const key of getEmailChangeRateLimitKeys("test-user-id", newEmail)) {
			expect(await redisClient.get(key)).toBeNull();
		}
		expect(sendEmail).not.toHaveBeenCalled();
	});

	it("limits password proofs by client IP as well as user", async () => {
		const headers = { "x-forwarded-for": "198.51.100.11" };
		const [actorKey, ipKey] = getEmailChangeProofRateLimitKeys(
			"test-user-id",
			new Headers(headers),
		);
		for (let attempt = 0; attempt < 10; attempt++) {
			await redisClient.del(actorKey);
			expect(
				(
					await patch(
						{ email: newEmail, currentPassword: "incorrect" },
						cookie,
						"test-user-id",
						headers,
					)
				).status,
			).toBe(401);
		}
		await redisClient.del(actorKey);
		expect(
			(
				await patch(
					{ email: newEmail, currentPassword },
					cookie,
					"test-user-id",
					headers,
				)
			).status,
		).toBe(429);
		expect(await redisClient.ttl(ipKey)).toBeGreaterThan(0);
		expect(sendEmail).not.toHaveBeenCalled();
	});

	it("explains missing email delivery without changing identity", async () => {
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("RESEND_API_KEY", "");
		const response = await patch({ email: newEmail, currentPassword });
		expect(response.status).toBe(503);
		expect((await response.json()).message).toContain("configure");
		expect((await storedUser())?.email).toBe("admin@example.com");
		expect(await db.query.verification.findMany()).toHaveLength(0);
		expect(sendEmail).not.toHaveBeenCalled();
	});

	it("applies the hosted verification risk check to the confirmation IP", async () => {
		await db
			.update(tables.user)
			.set({ emailVerified: false })
			.where(eq(tables.user.id, "test-user-id"));
		await patch({ email: newEmail, currentPassword });
		const ip = "198.51.100.9";
		checkIp
			.mockClear()
			.mockResolvedValue({ ipAddress: ip, abuseConfidenceScore: 100 });
		expect(
			(await confirm(confirmationToken(), { "x-forwarded-for": ip })).status,
		).toBe(200);
		const user = await storedUser();
		expect(user?.emailVerified).toBe(true);
		if (process.env.HOSTED === "true") {
			expect(checkIp).toHaveBeenCalledWith(ip);
			expect(user?.riskStatus).toBe("flagged");
			expect(user?.riskFlagSource).toBe("email_verification");
			expect(user?.riskFlagIp).toBe(ip);
		} else {
			expect(checkIp).not.toHaveBeenCalled();
			expect(user?.riskStatus).toBe("none");
		}
	});

	it("atomically limits a user's requests across recipients", async () => {
		const responses = await Promise.all(
			Array.from({ length: 6 }, (_, index) =>
				patch({ email: `pending${index}@example.com`, currentPassword }),
			),
		);
		expect(
			responses.filter((response) => response.status === 200),
		).toHaveLength(3);
		expect(
			responses.filter((response) => response.status === 429),
		).toHaveLength(3);
		expect(sendEmail).toHaveBeenCalledTimes(6);
		const [key] = getEmailChangeRateLimitKeys("test-user-id", newEmail);
		expect(await redisClient.ttl(key)).toBeGreaterThan(0);
		expect(await redisClient.ttl(key)).toBeLessThanOrEqual(3600);
	});

	it("limits a normalized recipient across different users", async () => {
		for (let count = 0; count < 3; count++) {
			expect((await patch({ email: newEmail, currentPassword })).status).toBe(
				200,
			);
		}
		const account = await db.query.account.findFirst({
			where: { id: "test-account-id" },
		});
		await db.insert(tables.user).values({
			id: "other-user-id",
			email: "other-user@example.com",
			emailVerified: true,
		});
		await db.insert(tables.account).values({
			id: "other-account-id",
			accountId: "other-account-id",
			userId: "other-user-id",
			providerId: "credential",
			password: account!.password,
		});
		const login = await signIn("other-user@example.com");
		expect(login.status).toBe(200);
		const otherCookie = login.headers.get("set-cookie")!;
		expect(
			(
				await patch(
					{ email: " CHANGED@EXAMPLE.COM ", currentPassword },
					otherCookie,
					"other-user-id",
				)
			).status,
		).toBe(429);
		expect(sendEmail).toHaveBeenCalledTimes(6);
		const [key] = getEmailChangeRateLimitKeys("other-user-id", newEmail);
		expect(await redisClient.get(key)).toBeNull();
		expect(
			(
				await patch(
					{ email: "available@example.com", currentPassword },
					otherCookie,
					"other-user-id",
				)
			).status,
		).toBe(200);
	});

	it("does not send or create a pending change when Redis fails", async () => {
		const reserve = vi
			.spyOn(redisClient, "eval")
			.mockRejectedValueOnce(new Error("Rate limit unavailable"));
		try {
			expect((await patch({ email: newEmail, currentPassword })).status).toBe(
				500,
			);
			expect(sendEmail).not.toHaveBeenCalled();
			expect(
				await db.query.verification.findFirst({
					where: { id: "email-change:test-user-id" },
				}),
			).toBeUndefined();
		} finally {
			reserve.mockRestore();
		}
	});

	it("consumes the confirmation token atomically", async () => {
		await patch({ email: newEmail, currentPassword });
		const token = confirmationToken();
		const responses = await Promise.all([confirm(token), confirm(token)]);
		expect(responses.map((response) => response.status).sort()).toEqual([
			200, 400,
		]);
		expect((await storedUser())?.email).toBe(newEmail);
	});

	it("also keeps an unverified account unchanged until confirmation", async () => {
		await db
			.update(tables.user)
			.set({ emailVerified: false })
			.where(eq(tables.user.id, "test-user-id"));
		await patch({ email: newEmail, currentPassword });
		expect((await storedUser())?.email).toBe("admin@example.com");
		expect((await storedUser())?.emailVerified).toBe(false);
		expect((await confirm(confirmationToken())).status).toBe(200);
		expect((await storedUser())?.emailVerified).toBe(true);
	});

	it("does not require proof for a case-only or profile update", async () => {
		expect(
			(await patch({ email: " ADMIN@EXAMPLE.COM ", name: "Updated Name" }))
				.status,
		).toBe(200);
		expect((await storedUser())?.email).toBe("admin@example.com");
		expect((await storedUser())?.name).toBe("Updated Name");
		expect(sendEmail).not.toHaveBeenCalled();
	});

	it("invalidates an earlier request when another address is requested", async () => {
		await patch({ email: newEmail, currentPassword });
		const oldToken = confirmationToken();
		await patch({ email: "other@example.com", currentPassword });
		expect((await confirm(oldToken)).status).toBe(400);
		expect((await confirm(confirmationToken())).status).toBe(200);
		expect((await storedUser())?.email).toBe("other@example.com");
	});

	it("rejects expired and incorrect tokens", async () => {
		await patch({ email: newEmail, currentPassword });
		expect((await confirm("0".repeat(64))).status).toBe(400);
		await db
			.update(tables.verification)
			.set({ expiresAt: new Date(0) })
			.where(eq(tables.verification.id, "email-change:test-user-id"));
		expect((await confirm(confirmationToken())).status).toBe(400);
		expect((await storedUser())?.email).toBe("admin@example.com");
	});

	it.each(["legacy", "invalid proof", "invalid JSON"])(
		"rejects malformed pending requests (%s)",
		async (kind) => {
			await patch({ email: newEmail, currentPassword });
			const pending = await db.query.verification.findFirst({
				where: { id: "email-change:test-user-id" },
			});
			const data: Record<string, unknown> = JSON.parse(pending!.value);
			delete data.credentialProof;
			if (kind === "legacy") {
				data.passwordFingerprint = "0".repeat(64);
			} else {
				data.credentialProof = "invalid";
			}
			await db
				.update(tables.verification)
				.set({ value: kind === "invalid JSON" ? "{" : JSON.stringify(data) })
				.where(eq(tables.verification.id, "email-change:test-user-id"));
			expect((await confirm(confirmationToken())).status).toBe(400);
			expect((await storedUser())?.email).toBe("admin@example.com");
		},
	);

	it.each(["new-test-password1A", currentPassword])(
		"invalidates pending changes when the credential hash rotates (%#)",
		async (newPassword) => {
			await patch({ email: newEmail, currentPassword });
			const response = await app.request("/auth/change-password", {
				method: "POST",
				headers: { Cookie: cookie, "Content-Type": "application/json" },
				body: JSON.stringify({
					currentPassword,
					newPassword,
				}),
			});
			expect(response.status).toBe(200);
			expect((await confirm(confirmationToken())).status).toBe(400);
			expect((await storedUser())?.email).toBe("admin@example.com");
		},
	);

	it("rejects a collision created after the change request", async () => {
		await patch({ email: newEmail, currentPassword });
		await db.insert(tables.user).values({
			id: "other-user",
			email: "Changed@Example.com",
			name: "Other User",
		});
		expect((await confirm(confirmationToken())).status).toBe(400);
		expect((await storedUser())?.email).toBe("admin@example.com");
	});

	it("does not apply a stale request to a changed or replaced account", async () => {
		await patch({ email: newEmail, currentPassword });
		await db
			.update(tables.user)
			.set({ email: "other@example.com" })
			.where(eq(tables.user.id, "test-user-id"));
		await db.insert(tables.user).values({
			id: "replacement-user",
			email: "admin@example.com",
			name: "Replacement User",
		});
		expect((await confirm(confirmationToken())).status).toBe(400);
		expect((await storedUser())?.email).toBe("other@example.com");
	});

	it.each(["old", "new"])(
		"removes the pending request when delivery to the %s address fails",
		async (address) => {
			if (address === "new") {
				sendEmail.mockResolvedValueOnce();
			}
			sendEmail.mockRejectedValueOnce(new Error("Email delivery unavailable"));
			expect((await patch({ email: newEmail, currentPassword })).status).toBe(
				500,
			);
			expect(
				await db.query.verification.findFirst({
					where: { id: "email-change:test-user-id" },
				}),
			).toBeUndefined();
			expect((await storedUser())?.email).toBe("admin@example.com");
		},
	);

	it("keeps alternate auth email mutation endpoints closed", async () => {
		expect(apiAuth.options.user?.changeEmail?.enabled).not.toBe(true);
		for (const [path, body] of [
			["/auth/change-email", { newEmail }],
			["/auth/update-user", { email: newEmail, emailVerified: true }],
		] as const) {
			const response = await app.request(path, {
				method: "POST",
				headers: { Cookie: cookie, "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			expect(response.status).toBe(400);
		}
		expect((await storedUser())?.email).toBe("admin@example.com");
	});
});
