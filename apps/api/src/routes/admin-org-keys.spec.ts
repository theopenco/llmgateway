import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

const originalAdminEmails = process.env.ADMIN_EMAILS;

const ORG_ID = "org-keys-test";
const PROJECT_ID = "org-keys-project";

async function get(path: string, token: string): Promise<Response> {
	return await app.request(`/admin/organizations/${ORG_ID}${path}`, {
		headers: { Cookie: token },
	});
}

async function seedOrg() {
	await db.insert(tables.organization).values({
		id: ORG_ID,
		name: "Org Keys Test",
		billingEmail: "org-keys@test.example",
		plan: "pro",
	});
	await db.insert(tables.project).values({
		id: PROJECT_ID,
		name: "Org Keys Project",
		organizationId: ORG_ID,
	});
}

describe("admin organization key listings", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();
		await seedOrg();
	});

	afterEach(async () => {
		if (originalAdminEmails === undefined) {
			delete process.env.ADMIN_EMAILS;
		} else {
			process.env.ADMIN_EMAILS = originalAdminEmails;
		}
		await deleteAll();
	});

	describe("api keys", () => {
		beforeEach(async () => {
			await db.insert(tables.apiKey).values([
				{
					id: "ak-active",
					projectId: PROJECT_ID,
					...hashApiKeyForStorage("ak-token-active"),
					description: "active key",
					createdBy: "test-user-id",
					status: "active",
				},
				{
					id: "ak-inactive",
					projectId: PROJECT_ID,
					...hashApiKeyForStorage("ak-token-inactive"),
					description: "disabled key",
					createdBy: "test-user-id",
					status: "inactive",
				},
				{
					id: "ak-deleted",
					projectId: PROJECT_ID,
					...hashApiKeyForStorage("ak-token-deleted"),
					description: "deleted key",
					createdBy: "test-user-id",
					status: "deleted",
				},
			]);
		});

		it("defaults to active keys while reporting every status in the counts", async () => {
			const res = await get("/api-keys", cookie);
			expect(res.status).toBe(200);
			const json = await res.json();

			expect(json.apiKeys.map((k: { id: string }) => k.id)).toEqual([
				"ak-active",
			]);
			expect(json.total).toBe(1);
			expect(json.counts).toEqual({
				all: 3,
				active: 1,
				inactive: 1,
				deleted: 1,
			});
		});

		it("filters by each status and returns everything for all", async () => {
			for (const status of ["inactive", "deleted"]) {
				const res = await get(`/api-keys?status=${status}`, cookie);
				const json = await res.json();
				expect(json.apiKeys.map((k: { id: string }) => k.id)).toEqual([
					`ak-${status}`,
				]);
				expect(json.total).toBe(1);
				// Counts stay organization-wide so the tab header is stable.
				expect(json.counts.all).toBe(3);
			}

			const all = await get("/api-keys?status=all", cookie);
			const allJson = await all.json();
			expect(allJson.apiKeys).toHaveLength(3);
			expect(allJson.total).toBe(3);
		});

		it("counts a legacy NULL status as active", async () => {
			await db.insert(tables.apiKey).values({
				id: "ak-null",
				projectId: PROJECT_ID,
				...hashApiKeyForStorage("ak-token-null"),
				description: "legacy key",
				createdBy: "test-user-id",
				status: null,
			});

			const res = await get("/api-keys", cookie);
			const json = await res.json();
			expect(json.apiKeys.map((k: { id: string }) => k.id).sort()).toEqual([
				"ak-active",
				"ak-null",
			]);
			expect(json.counts.active).toBe(2);
			expect(json.counts.all).toBe(4);
		});
	});

	describe("provider keys", () => {
		beforeEach(async () => {
			await db.insert(tables.providerKey).values([
				{
					id: "pk-active",
					organizationId: ORG_ID,
					provider: "openai",
					...encryptProviderKeyForStorage("sk-active", "pk-active", ORG_ID),
					status: "active",
				},
				{
					id: "pk-inactive",
					organizationId: ORG_ID,
					provider: "anthropic",
					...encryptProviderKeyForStorage("sk-inactive", "pk-inactive", ORG_ID),
					status: "inactive",
				},
				{
					id: "pk-deleted",
					organizationId: ORG_ID,
					provider: "google-ai-studio",
					...encryptProviderKeyForStorage("sk-deleted", "pk-deleted", ORG_ID),
					status: "deleted",
				},
			]);
		});

		it("defaults to active keys while reporting every status in the counts", async () => {
			const res = await get("/provider-keys", cookie);
			expect(res.status).toBe(200);
			const json = await res.json();

			expect(json.providerKeys.map((k: { id: string }) => k.id)).toEqual([
				"pk-active",
			]);
			expect(json.total).toBe(1);
			expect(json.counts).toEqual({
				all: 3,
				active: 1,
				inactive: 1,
				deleted: 1,
			});
		});

		it("filters by each status and returns everything for all", async () => {
			for (const status of ["inactive", "deleted"]) {
				const res = await get(`/provider-keys?status=${status}`, cookie);
				const json = await res.json();
				expect(json.providerKeys.map((k: { id: string }) => k.id)).toEqual([
					`pk-${status}`,
				]);
				expect(json.counts.all).toBe(3);
			}

			const all = await get("/provider-keys?status=all", cookie);
			const allJson = await all.json();
			expect(allJson.providerKeys).toHaveLength(3);
			expect(allJson.total).toBe(3);
		});
	});
});
