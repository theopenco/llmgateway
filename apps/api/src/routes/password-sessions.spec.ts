import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";
import * as email from "@/utils/email.js";

import { db } from "@llmgateway/db";

const currentPassword = "admin@example.com1A";
const newPassword = "ChangedPassword123!";
const origin = process.env.UI_URL ?? "http://localhost:3002";

function cookies(response: Response) {
	return response.headers
		.getSetCookie()
		.map((cookie) => cookie.split(";")[0])
		.join("; ");
}

async function signIn(password = currentPassword) {
	return await app.request("/auth/sign-in/email", {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: origin },
		body: JSON.stringify({ email: "admin@example.com", password }),
	});
}

async function assertAccess(headers: Record<string, string>, status: number) {
	expect((await app.request("/user/me", { headers })).status).toBe(status);
	expect(
		(
			await app.request("/user/me", {
				method: "PATCH",
				headers: { ...headers, "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Test User" }),
			})
		).status,
	).toBe(status);
}

describe("password session revocation", () => {
	let ownerCookie: string;
	let otherCookie: string;
	let otherToken: string;

	beforeEach(async () => {
		await createTestUser();
		const owner = await signIn();
		const other = await signIn();
		expect(owner.status).toBe(200);
		expect(other.status).toBe(200);
		ownerCookie = cookies(owner);
		otherCookie = cookies(other);
		otherToken = other.headers.get("set-auth-token")!;
		expect(ownerCookie).not.toBe(otherCookie);
		expect(otherToken).toBeTruthy();
		await assertAccess({ Cookie: ownerCookie }, 200);
		await assertAccess({ Cookie: otherCookie }, 200);
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await deleteAll();
	});

	test("password changes rotate the caller's cookie and revoke existing cookie and bearer sessions", async () => {
		const response = await app.request("/user/password", {
			method: "PUT",
			headers: {
				Cookie: ownerCookie,
				Origin: origin,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ currentPassword, newPassword }),
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			message: "Password updated successfully",
		});
		const newCookie = cookies(response);
		expect(newCookie).toContain("session_token=");
		expect(newCookie).not.toBe(ownerCookie);
		await assertAccess({ Cookie: newCookie }, 200);
		await assertAccess({ Cookie: ownerCookie }, 401);
		await assertAccess({ Cookie: otherCookie }, 401);
		await assertAccess({ Authorization: `Bearer ${otherToken}` }, 401);
		expect(await db.query.session.findMany()).toHaveLength(1);
		expect((await signIn()).status).toBe(401);
		expect((await signIn(newPassword)).status).toBe(200);
	});

	test("password changes return a usable replacement for a bearer caller", async () => {
		const response = await app.request("/user/password", {
			method: "PUT",
			headers: {
				Authorization: `Bearer ${otherToken}`,
				Origin: origin,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ currentPassword, newPassword }),
		});
		expect(response.status).toBe(200);
		const token = response.headers.get("set-auth-token");
		expect(token).toBeTruthy();
		expect(token).not.toBe(otherToken);
		expect(response.headers.get("access-control-expose-headers")).toContain(
			"set-auth-token",
		);
		await assertAccess({ Authorization: `Bearer ${token}` }, 200);
		await assertAccess({ Authorization: `Bearer ${otherToken}` }, 401);
		await assertAccess({ Cookie: ownerCookie }, 401);
	});

	test.each([undefined, false])(
		"the direct password endpoint revokes sessions with revokeOtherSessions=%s",
		async (revokeOtherSessions) => {
			const response = await app.request("/auth/change-password", {
				method: "POST",
				headers: {
					Cookie: ownerCookie,
					Origin: origin,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					currentPassword,
					newPassword,
					revokeOtherSessions,
				}),
			});
			expect(response.status).toBe(200);
			await assertAccess({ Cookie: cookies(response) }, 200);
			await assertAccess({ Cookie: ownerCookie }, 401);
			await assertAccess({ Cookie: otherCookie }, 401);
		},
	);

	test("password resets revoke every session and allow signing in with the new password", async () => {
		const sendEmail = vi
			.spyOn(email, "sendTransactionalEmail")
			.mockResolvedValue(undefined);
		const request = await app.request("/auth/request-password-reset", {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: origin },
			body: JSON.stringify({
				email: "admin@example.com",
				redirectTo: `${origin}/reset-password`,
			}),
		});
		expect(request.status).toBe(200);
		expect(sendEmail).toHaveBeenCalledOnce();
		const resetToken = sendEmail.mock.calls[0][0].text?.match(
			/\/reset-password\/([^?\s]+)/,
		)?.[1];
		expect(resetToken).toBeTruthy();
		await assertAccess({ Cookie: ownerCookie }, 200);
		await assertAccess({ Cookie: otherCookie }, 200);
		const response = await app.request("/auth/reset-password", {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: origin },
			body: JSON.stringify({ token: resetToken, newPassword }),
		});
		expect(response.status).toBe(200);
		await assertAccess({ Cookie: ownerCookie }, 401);
		await assertAccess({ Cookie: otherCookie }, 401);
		await assertAccess({ Authorization: `Bearer ${otherToken}` }, 401);
		expect(await db.query.session.findMany()).toHaveLength(0);
		expect((await signIn()).status).toBe(401);
		const login = await signIn(newPassword);
		expect(login.status).toBe(200);
		await assertAccess({ Cookie: cookies(login) }, 200);
	});

	test.each([
		undefined,
		"invalid",
		{ currentPassword: "incorrect", newPassword },
	])("invalid password changes leave sessions usable (%j)", async (body) => {
		const response = await app.request("/auth/change-password", {
			method: "POST",
			headers: {
				Cookie: ownerCookie,
				Origin: origin,
				"Content-Type": "application/json",
			},
			body: body ? JSON.stringify(body) : undefined,
		});
		expect(response.status).toBe(400);
		await assertAccess({ Cookie: ownerCookie }, 200);
		await assertAccess({ Cookie: otherCookie }, 200);
	});
});
