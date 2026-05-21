import { expect, test, beforeEach, describe, afterEach } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

describe("provider keys route", () => {
	let token: string;

	afterEach(async () => {
		await deleteAll();
	});

	beforeEach(async () => {
		token = await createTestUser();

		// Create test organization
		await db.insert(tables.organization).values({
			id: "test-org-id",
			name: "Test Organization",
			billingEmail: "test@example.com",
			plan: "pro",
		});

		// Associate user with organization
		await db.insert(tables.userOrganization).values({
			id: "test-user-org-id",
			userId: "test-user-id",
			organizationId: "test-org-id",
		});

		// Create test project
		await db.insert(tables.project).values({
			id: "test-project-id",
			name: "Test Project",
			organizationId: "test-org-id",
		});

		// Create test provider key
		await db.insert(tables.providerKey).values({
			id: "test-provider-key-id",
			token: "test-provider-token",
			provider: "openai",
			organizationId: "test-org-id",
		});
	});

	test("GET /keys/provider unauthorized", async () => {
		const res = await app.request("/keys/provider");
		expect(res.status).toBe(401);
	});

	test("POST /keys/provider unauthorized", async () => {
		const res = await app.request("/keys/provider", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				provider: "openai",
			}),
		});
		expect(res.status).toBe(401);
	});

	test("DELETE /keys/provider/test-provider-key-id unauthorized", async () => {
		const res = await app.request("/keys/provider/test-provider-key-id", {
			method: "DELETE",
		});
		expect(res.status).toBe(401);
	});

	test("PATCH /keys/provider/test-provider-key-id unauthorized", async () => {
		const res = await app.request("/keys/provider/test-provider-key-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				status: "inactive",
			}),
		});
		expect(res.status).toBe(401);
	});

	test("GET /keys/provider", async () => {
		const res = await app.request("/keys/provider", {
			headers: {
				Cookie: token,
			},
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toHaveProperty("providerKeys");
		expect(json.providerKeys.length).toBe(1);
		expect(json.providerKeys[0].provider).toBe("openai");
	});

	test("POST /keys/provider", async () => {
		const res = await app.request("/keys/provider", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				provider: "inference.net",
				token: "inference-test-token",
				organizationId: "test-org-id",
			}),
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toHaveProperty("providerKey");
		expect(json.providerKey.provider).toBe("inference.net");
		expect(json.providerKey.maskedToken).toBeDefined();
		expect(json.providerKey.maskedToken).toContain("•");
		expect(json.providerKey.token).toBeUndefined();
		// Response must never expose the ciphertext column either.
		expect(json.providerKey.tokenCiphertext).toBeUndefined();
		expect(json.providerKey.tokenMasked).toBeUndefined();

		// Verify the key was created in the database AND that the plaintext
		// was never persisted — only the ciphertext + masked form should remain.
		const providerKey = await db.query.providerKey.findFirst({
			where: {
				provider: {
					eq: "inference.net",
				},
			},
		});
		expect(providerKey).not.toBeNull();
		expect(providerKey?.provider).toBe("inference.net");
		expect(providerKey?.token).toBeNull();
		expect(providerKey?.tokenCiphertext).toMatch(/^llmgw:v1:/);
		expect(providerKey?.tokenMasked).toBeTruthy();
		expect(providerKey?.tokenMasked).not.toBe("inference-test-token");
	});

	test("POST /keys/provider AAD binds ciphertext to row id + organization", async () => {
		const res = await app.request("/keys/provider", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				provider: "inference.net",
				token: "aad-bound-token",
				organizationId: "test-org-id",
			}),
		});
		expect(res.status).toBe(200);

		const row = await db.query.providerKey.findFirst({
			where: { provider: { eq: "inference.net" } },
		});
		expect(row?.tokenCiphertext).toMatch(/^llmgw:v1:/);

		// Importing locally to avoid pulling crypto into the top of the spec file.
		const { decryptProviderKey } = await import("@llmgateway/actions");

		// Correct row id + org → decrypts.
		expect(
			decryptProviderKey(row!.tokenCiphertext!, row!.id, row!.organizationId),
		).toBe("aad-bound-token");

		// Tampered row id → throws (cross-row copy fails).
		expect(() =>
			decryptProviderKey(
				row!.tokenCiphertext!,
				"different-row-id",
				row!.organizationId,
			),
		).toThrow();

		// Tampered organization id → throws (cross-org copy fails).
		expect(() =>
			decryptProviderKey(row!.tokenCiphertext!, row!.id, "different-org"),
		).toThrow();
	});

	test("provider_key CHECK constraint rejects rows with both token and tokenCiphertext", async () => {
		await expect(
			db.insert(tables.providerKey).values({
				id: "test-bad-shape",
				token: "plaintext-here",
				tokenCiphertext: "llmgw:v1:should-not-coexist:::",
				provider: "openai",
				organizationId: "test-org-id",
			}),
		).rejects.toThrow();
	});

	test("POST /keys/provider rejects token with non-ASCII characters", async () => {
		const res = await app.request("/keys/provider", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				provider: "openai",
				token: "sk-realprefix••••••••",
				organizationId: "test-org-id",
			}),
		});
		expect(res.status).toBe(400);
	});

	test("POST /keys/provider with invalid provider", async () => {
		const res = await app.request("/keys/provider", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				provider: "invalid-provider",
				organizationId: "test-org-id",
			}),
		});
		expect(res.status).toBe(400);
	});

	test("POST /keys/provider with duplicate provider", async () => {
		const res = await app.request("/keys/provider", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				provider: "openai",
				token: "test-provider-token-2",
				organizationId: "test-org-id",
			}),
		});
		expect(res.status).toBe(200);

		const providerKeys = await db.query.providerKey.findMany({
			where: {
				provider: {
					eq: "openai",
				},
			},
		});
		expect(providerKeys).toHaveLength(2);
	});

	test("POST /keys/provider rejects duplicate custom provider names", async () => {
		await db.insert(tables.providerKey).values({
			id: "test-custom-provider-key-id",
			token: "test-custom-provider-token",
			provider: "custom",
			name: "mycustomprovider",
			baseUrl: "https://example.com",
			organizationId: "test-org-id",
		});

		const res = await app.request("/keys/provider", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				provider: "custom",
				token: "test-custom-provider-token-2",
				name: "mycustomprovider",
				baseUrl: "https://example-2.com",
				organizationId: "test-org-id",
			}),
		});
		expect(res.status).toBe(400);
	});

	test("PATCH /keys/provider/{id}", async () => {
		const res = await app.request("/keys/provider/test-provider-key-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				status: "inactive",
			}),
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toHaveProperty("message");
		expect(json).toHaveProperty("providerKey");
		expect(json.providerKey.status).toBe("inactive");

		// Verify the key was updated in the database
		const providerKey = await db.query.providerKey.findFirst({
			where: {
				id: {
					eq: "test-provider-key-id",
				},
			},
		});
		expect(providerKey).not.toBeNull();
		expect(providerKey?.status).toBe("inactive");
	});

	test("DELETE /keys/provider/{id}", async () => {
		const res = await app.request("/keys/provider/test-provider-key-id", {
			method: "DELETE",
			headers: {
				Cookie: token,
			},
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toHaveProperty("message");
		expect(json.message).toBe("Provider key deleted successfully");

		// Verify the key was soft-deleted in the database
		const providerKey = await db.query.providerKey.findFirst({
			where: {
				id: {
					eq: "test-provider-key-id",
				},
			},
		});
		expect(providerKey).not.toBeNull();
		expect(providerKey?.status).toBe("deleted");
	});
});
