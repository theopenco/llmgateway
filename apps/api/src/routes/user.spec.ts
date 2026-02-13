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
