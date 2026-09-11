import { APIError } from "better-auth/api";
import { hashPassword } from "better-auth/crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiAuth } from "@/auth/config.js";
import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

const currentPassword = "admin@example.com1A";
const validPassword = "Password123!";

function signIn(password: string) {
	return app.request("/auth/sign-in/email", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email: "admin@example.com", password }),
	});
}

async function getPasswordHash() {
	const account = await db.query.account.findFirst({
		where: { id: { eq: "test-account-id" } },
	});
	return account?.password;
}

describe("password change validation", () => {
	let cookie: string;
	let originalHash: string | null | undefined;

	beforeEach(async () => {
		cookie = await createTestUser();
		originalHash = await getPasswordHash();
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await deleteAll();
	});

	function changePassword(
		newPassword = validPassword,
		password = currentPassword,
	) {
		return app.request("/user/password", {
			method: "PUT",
			headers: { "Content-Type": "application/json", Cookie: cookie },
			body: JSON.stringify({ currentPassword: password, newPassword }),
		});
	}

	async function expectPasswordUnchanged() {
		expect(await getPasswordHash()).toBe(originalHash);
		expect((await signIn(currentPassword)).status).toBe(200);
	}

	it("returns 401 for an incorrect current password without changing it", async () => {
		const response = await changePassword(validPassword, "IncorrectPassword!");

		expect(response.status).toBe(401);
		expect(await response.json()).toMatchObject({
			message: "Current password is incorrect",
		});
		await expectPasswordUnchanged();
	});

	it.each([8, 9, 10, 11, 129])(
		"rejects a %i-character new password before calling auth",
		async (length) => {
			const change = vi.spyOn(apiAuth.api, "changePassword");
			const response = await changePassword("a".repeat(length));

			expect(response.status).toBe(400);
			expect(change).not.toHaveBeenCalled();
			await expectPasswordUnchanged();
		},
	);

	it.each([12, 128])(
		"accepts a %i-character new password and changes the login credential",
		async (length) => {
			const password = "a".repeat(length);
			const response = await changePassword(password);

			expect(response.status).toBe(200);
			expect(await getPasswordHash()).not.toBe(originalHash);
			expect((await signIn(currentPassword)).status).toBe(401);
			expect((await signIn(password)).status).toBe(200);
		},
	);

	it("allows a legacy short current password when choosing a compliant replacement", async () => {
		const legacyPassword = "OldPass1";
		await db
			.update(tables.account)
			.set({ password: await hashPassword(legacyPassword) })
			.where(eq(tables.account.id, "test-account-id"));

		expect((await signIn(legacyPassword)).status).toBe(200);
		expect((await changePassword(validPassword, legacyPassword)).status).toBe(
			200,
		);
		expect((await signIn(validPassword)).status).toBe(200);
	});

	it("returns 401 when the user has no password credential", async () => {
		await db
			.delete(tables.account)
			.where(eq(tables.account.id, "test-account-id"));
		const response = await changePassword();

		expect(response.status).toBe(401);
		expect(await response.json()).toMatchObject({
			message: "Current password is incorrect",
		});
		expect(await getPasswordHash()).toBeUndefined();
	});

	it("requires an authenticated session", async () => {
		cookie = "";
		expect((await changePassword()).status).toBe(401);
		await expectPasswordUnchanged();
	});

	it("requires the current password", async () => {
		const response = await app.request("/user/password", {
			method: "PUT",
			headers: { "Content-Type": "application/json", Cookie: cookie },
			body: JSON.stringify({ newPassword: validPassword }),
		});

		expect(response.status).toBe(400);
		await expectPasswordUnchanged();
	});

	it.each(["PASSWORD_TOO_SHORT", "PASSWORD_TOO_LONG"])(
		"maps the auth policy rejection %s to 400",
		async (code) => {
			vi.spyOn(apiAuth.api, "changePassword").mockRejectedValueOnce(
				new APIError("BAD_REQUEST", {
					code,
					message: "Invalid password length",
				}),
			);

			const response = await changePassword();
			expect(response.status).toBe(400);
			expect(await response.json()).toMatchObject({
				message: "Password must be between 12 and 128 characters",
			});
			await expectPasswordUnchanged();
		},
	);

	it.each([
		new Error("Database unavailable"),
		new APIError("INTERNAL_SERVER_ERROR", {
			code: "FAILED_TO_UPDATE_USER",
			message: "Update failed",
		}),
		Object.assign(new Error("Unexpected failure"), {
			body: { code: "INVALID_PASSWORD" },
		}),
	])(
		"keeps unexpected errors as 500 without exposing details: %s",
		async (error) => {
			vi.spyOn(apiAuth.api, "changePassword").mockRejectedValueOnce(error);

			const response = await changePassword();
			expect(response.status).toBe(500);
			expect(await response.json()).toEqual({
				error: true,
				status: 500,
				message: "Internal Server Error",
			});
			await expectPasswordUnchanged();
		},
	);
});
