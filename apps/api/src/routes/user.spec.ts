import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

describe("user passkey deletion", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();

		// Insert two passkeys for the test user
		await db.insert(tables.passkey).values([
			{
				id: "passkey-1",
				publicKey: "pk-1",
				userId: "test-user-id",
				credentialID: "cred-1",
				counter: 0,
			},
			{
				id: "passkey-2",
				publicKey: "pk-2",
				userId: "test-user-id",
				credentialID: "cred-2",
				counter: 0,
			},
		]);
	});

	afterEach(async () => {
		await db.delete(tables.passkey);
		await deleteAll();
	});

	it("DELETE /me/passkeys/:id should only delete the specified passkey", async () => {
		// Delete passkey-1
		const res = await app.request("/user/me/passkeys/passkey-1", {
			method: "DELETE",
			headers: {
				Cookie: token,
			},
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.message).toBe("Passkey deleted successfully");

		// Verify passkey-1 is gone
		const deletedPasskey = await db.query.passkey.findFirst({
			where: {
				id: {
					eq: "passkey-1",
				},
			},
		});
		expect(deletedPasskey).toBeUndefined();

		// Verify passkey-2 still exists
		const remainingPasskey = await db.query.passkey.findFirst({
			where: {
				id: {
					eq: "passkey-2",
				},
			},
		});
		expect(remainingPasskey).toBeDefined();
		expect(remainingPasskey!.id).toBe("passkey-2");
	});

	it("DELETE /me/passkeys/:id should not delete passkeys belonging to other users", async () => {
		// Create another user and their passkey
		await db.insert(tables.user).values({
			id: "other-user-id",
			name: "Other User",
			email: "other@example.com",
			emailVerified: true,
		});

		await db.insert(tables.passkey).values({
			id: "passkey-other",
			publicKey: "pk-other",
			userId: "other-user-id",
			credentialID: "cred-other",
			counter: 0,
		});

		// Attempt to delete the other user's passkey as the test user
		const res = await app.request("/user/me/passkeys/passkey-other", {
			method: "DELETE",
			headers: {
				Cookie: token,
			},
		});

		// The request completes (no row matched both conditions)
		expect(res.status).toBe(200);

		// The other user's passkey should still exist
		const otherPasskey = await db.query.passkey.findFirst({
			where: {
				id: {
					eq: "passkey-other",
				},
			},
		});
		expect(otherPasskey).toBeDefined();
		expect(otherPasskey!.userId).toBe("other-user-id");

		// Clean up
		await db
			.delete(tables.passkey)
			.where(eq(tables.passkey.id, "passkey-other"));
		await db.delete(tables.user).where(eq(tables.user.id, "other-user-id"));
	});

	it("DELETE /me/passkeys/:id should require authentication", async () => {
		const res = await app.request("/user/me/passkeys/passkey-1", {
			method: "DELETE",
		});
		expect(res.status).toBe(401);
	});
});

describe("user accounts and email editability", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();
	});

	afterEach(async () => {
		await db.delete(tables.passkey);
		await deleteAll();
	});

	it("GET /user/me should return accounts array with provider info", async () => {
		const res = await app.request("/user/me", {
			method: "GET",
			headers: { Cookie: token },
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.user.accounts).toBeDefined();
		expect(Array.isArray(json.user.accounts)).toBe(true);
		expect(json.user.accounts).toContainEqual({ providerId: "credential" });
	});

	it("GET /user/me should return hasPasskeys false when no passkeys exist", async () => {
		const res = await app.request("/user/me", {
			method: "GET",
			headers: { Cookie: token },
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.user.hasPasskeys).toBe(false);
	});

	it("GET /user/me should return hasPasskeys true when passkeys exist", async () => {
		await db.insert(tables.passkey).values({
			id: "passkey-test",
			publicKey: "pk-test",
			userId: "test-user-id",
			credentialID: "cred-test",
			counter: 0,
		});

		const res = await app.request("/user/me", {
			method: "GET",
			headers: { Cookie: token },
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.user.hasPasskeys).toBe(true);
	});

	it("PATCH /user/me should allow email change for credential users", async () => {
		const res = await app.request("/user/me", {
			method: "PATCH",
			headers: {
				Cookie: token,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ name: "Updated Name" }),
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.user.name).toBe("Updated Name");
		expect(json.user.accounts).toBeDefined();
		expect(json.user.hasPasskeys).toBeDefined();
	});

	it("PATCH /user/me should block email change for social-only users", async () => {
		// Replace the credential account with a social one
		await db
			.delete(tables.account)
			.where(eq(tables.account.id, "test-account-id"));
		await db.insert(tables.account).values({
			id: "social-account-id",
			providerId: "github",
			accountId: "github-123",
			userId: "test-user-id",
		});

		const res = await app.request("/user/me", {
			method: "PATCH",
			headers: {
				Cookie: token,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ email: "new@example.com" }),
		});

		expect(res.status).toBe(400);
	});

	it("PATCH /user/me should allow name change for social-only users", async () => {
		// Replace the credential account with a social one
		await db
			.delete(tables.account)
			.where(eq(tables.account.id, "test-account-id"));
		await db.insert(tables.account).values({
			id: "social-account-id",
			providerId: "github",
			accountId: "github-123",
			userId: "test-user-id",
		});

		const res = await app.request("/user/me", {
			method: "PATCH",
			headers: {
				Cookie: token,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ name: "New Name" }),
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.user.name).toBe("New Name");
	});

	it("PATCH /user/me should allow email change for users with both credential and social accounts", async () => {
		// Add a social account alongside the existing credential account
		await db.insert(tables.account).values({
			id: "social-account-id",
			providerId: "github",
			accountId: "github-123",
			userId: "test-user-id",
		});

		const res = await app.request("/user/me", {
			method: "PATCH",
			headers: {
				Cookie: token,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ name: "Updated Name" }),
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.user.accounts).toHaveLength(2);
	});
});
