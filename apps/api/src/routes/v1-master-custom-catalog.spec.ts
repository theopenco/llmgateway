import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { readProviderKey } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";
import { getApiKeyFingerprint } from "@llmgateway/shared/api-key-hash";

describe("v1/master custom providers and models", () => {
	let masterToken: string;

	beforeEach(async () => {
		// createTestUser runs deleteAll and seeds test-user-id.
		await createTestUser();

		await db.insert(tables.organization).values([
			{
				id: "test-org-id",
				name: "Test Organization",
				billingEmail: "test@example.com",
				plan: "enterprise",
			},
			{
				id: "other-org-id",
				name: "Other Organization",
				billingEmail: "other@example.com",
				plan: "enterprise",
			},
		]);

		await db.insert(tables.userOrganization).values({
			id: "test-user-org-id",
			userId: "test-user-id",
			organizationId: "test-org-id",
			role: "owner",
		});

		await db.insert(tables.project).values({
			id: "test-project-id",
			name: "Test Project",
			organizationId: "test-org-id",
		});

		masterToken = `mk-${crypto.randomUUID()}`;
		await db.insert(tables.masterKey).values({
			id: "test-master-key-id",
			tokenHash: getApiKeyFingerprint(masterToken),
			maskedToken: "mk-****",
			description: "Test Master Key",
			status: "active",
			organizationId: "test-org-id",
			createdBy: "test-user-id",
		});
	});

	afterEach(async () => {
		await deleteAll();
	});

	function authHeaders(extra: Record<string, string> = {}) {
		return {
			Authorization: `Bearer ${masterToken}`,
			...extra,
		};
	}

	function request(path: string, init: RequestInit = {}) {
		return app.request(`/v1/master${path}`, {
			...init,
			headers: authHeaders(
				init.body ? { "Content-Type": "application/json" } : {},
			),
		});
	}

	async function createProvider(name = "acme") {
		const res = await request("/custom-providers", {
			method: "POST",
			body: JSON.stringify({
				name,
				baseUrl: "https://llm.acme.example.com/v1",
				token: "sk-acme-secret",
			}),
		});
		expect(res.status).toBe(201);
		const json = (await res.json()) as {
			customProvider: { id: string; maskedToken: string; token?: string };
		};
		return json.customProvider;
	}

	test("creates a custom provider without echoing the plaintext token", async () => {
		const provider = await createProvider();

		expect(provider.token).toBeUndefined();
		expect(provider.maskedToken).not.toContain("secret");

		const stored = await db.query.providerKey.findFirst({
			where: { id: { eq: provider.id } },
		});
		expect(stored?.provider).toBe("custom");
		expect(stored?.organizationId).toBe("test-org-id");
		// Stored encrypted at rest: the legacy plaintext column stays NULL and
		// the ciphertext decrypts back to the submitted token.
		expect(stored?.token).toBeNull();
		expect(stored?.tokenCiphertext).toMatch(/^llmgw:v2:/);
		expect(readProviderKey(stored!)).toBe("sk-acme-secret");
	});

	test("rejects a duplicate custom provider name in the same organization", async () => {
		await createProvider("acme");

		const res = await request("/custom-providers", {
			method: "POST",
			body: JSON.stringify({
				name: "acme",
				baseUrl: "https://other.example.com/v1",
				token: "sk-other",
			}),
		});
		expect(res.status).toBe(400);
	});

	test("lists, reads and updates custom providers", async () => {
		const provider = await createProvider();

		const listRes = await request("/custom-providers");
		expect(listRes.status).toBe(200);
		const list = (await listRes.json()) as {
			customProviders: { id: string }[];
		};
		expect(list.customProviders.map((p) => p.id)).toEqual([provider.id]);

		const patchRes = await request(`/custom-providers/${provider.id}`, {
			method: "PATCH",
			body: JSON.stringify({
				baseUrl: "https://llm2.acme.example.com/v1",
				customModelsOnly: true,
				status: "inactive",
			}),
		});
		expect(patchRes.status).toBe(200);

		const getRes = await request(`/custom-providers/${provider.id}`);
		expect(getRes.status).toBe(200);
		const fetched = (await getRes.json()) as {
			customProvider: {
				baseUrl: string;
				customModelsOnly: boolean;
				status: string;
			};
		};
		expect(fetched.customProvider.baseUrl).toBe(
			"https://llm2.acme.example.com/v1",
		);
		expect(fetched.customProvider.customModelsOnly).toBe(true);
		expect(fetched.customProvider.status).toBe("inactive");
	});

	test("soft-deletes a custom provider and hides it afterwards", async () => {
		const provider = await createProvider();

		const deleteRes = await request(`/custom-providers/${provider.id}`, {
			method: "DELETE",
		});
		expect(deleteRes.status).toBe(200);

		const getRes = await request(`/custom-providers/${provider.id}`);
		expect(getRes.status).toBe(404);

		const stored = await db.query.providerKey.findFirst({
			where: { id: { eq: provider.id } },
		});
		expect(stored?.status).toBe("deleted");
	});

	test("does not expose provider keys from other organizations", async () => {
		const [foreign] = await db
			.insert(tables.providerKey)
			.values({
				organizationId: "other-org-id",
				provider: "custom",
				name: "foreign",
				baseUrl: "https://foreign.example.com/v1",
				token: "sk-foreign",
			})
			.returning();

		const getRes = await request(`/custom-providers/${foreign.id}`);
		expect(getRes.status).toBe(404);

		const listRes = await request("/custom-providers");
		const list = (await listRes.json()) as {
			customProviders: { id: string }[];
		};
		expect(list.customProviders).toHaveLength(0);
	});

	test("rejects a non-custom provider key by id", async () => {
		const [byok] = await db
			.insert(tables.providerKey)
			.values({
				organizationId: "test-org-id",
				provider: "openai",
				token: "sk-openai",
			})
			.returning();

		const res = await request(`/custom-providers/${byok.id}`);
		expect(res.status).toBe(404);
	});

	test("round-trips custom model pricing and context window", async () => {
		const provider = await createProvider();

		const createRes = await request("/custom-models", {
			method: "POST",
			body: JSON.stringify({
				providerKeyId: provider.id,
				modelName: "acme-large",
				displayName: "Acme Large",
				contextSize: 200000,
				maxOutput: 32000,
				inputPrice: "3.0e-6",
				outputPrice: "15.0e-6",
				cachedInputPrice: "0.3e-6",
				streaming: "true",
				vision: true,
				tools: true,
				supportedParameters: ["temperature", "top_p"],
			}),
		});
		expect(createRes.status).toBe(201);
		const created = (await createRes.json()) as {
			customModel: { id: string; contextSize: number; inputPrice: string };
		};
		expect(created.customModel.contextSize).toBe(200000);
		expect(created.customModel.inputPrice).toBe("3.0e-6");

		const listRes = await request(
			`/custom-models?providerKeyId=${provider.id}`,
		);
		expect(listRes.status).toBe(200);
		const list = (await listRes.json()) as {
			customModels: {
				id: string;
				modelName: string;
				maxOutput: number;
				outputPrice: string;
				supportedParameters: string[];
			}[];
		};
		expect(list.customModels).toHaveLength(1);
		expect(list.customModels[0].modelName).toBe("acme-large");
		expect(list.customModels[0].maxOutput).toBe(32000);
		expect(list.customModels[0].outputPrice).toBe("15.0e-6");
		expect(list.customModels[0].supportedParameters).toEqual([
			"temperature",
			"top_p",
		]);

		const patchRes = await request(`/custom-models/${created.customModel.id}`, {
			method: "PATCH",
			body: JSON.stringify({ contextSize: 400000, status: "inactive" }),
		});
		expect(patchRes.status).toBe(200);
		const patched = (await patchRes.json()) as {
			customModel: { contextSize: number; status: string };
		};
		expect(patched.customModel.contextSize).toBe(400000);
		expect(patched.customModel.status).toBe("inactive");

		const deleteRes = await request(
			`/custom-models/${created.customModel.id}`,
			{
				method: "DELETE",
			},
		);
		expect(deleteRes.status).toBe(200);

		const afterRes = await request("/custom-models");
		const after = (await afterRes.json()) as { customModels: unknown[] };
		expect(after.customModels).toHaveLength(0);
	});

	test("rejects a duplicate model name on the same provider", async () => {
		const provider = await createProvider();

		const body = JSON.stringify({
			providerKeyId: provider.id,
			modelName: "acme-large",
		});
		expect(
			(await request("/custom-models", { method: "POST", body })).status,
		).toBe(201);
		expect(
			(await request("/custom-models", { method: "POST", body })).status,
		).toBe(400);
	});

	test("rejects custom models for a provider in another organization", async () => {
		const [foreign] = await db
			.insert(tables.providerKey)
			.values({
				organizationId: "other-org-id",
				provider: "custom",
				name: "foreign",
				baseUrl: "https://foreign.example.com/v1",
				token: "sk-foreign",
			})
			.returning();

		const res = await request("/custom-models", {
			method: "POST",
			body: JSON.stringify({
				providerKeyId: foreign.id,
				modelName: "foreign-model",
			}),
		});
		expect(res.status).toBe(404);
	});

	test("requires a valid master key", async () => {
		const res = await app.request("/v1/master/custom-models", {
			headers: { Authorization: "Bearer not-a-real-master-key" },
		});
		expect(res.status).toBe(401);
	});
});
