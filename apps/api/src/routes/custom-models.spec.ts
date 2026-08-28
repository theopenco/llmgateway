import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";

const ORG_ID = "custom-models-org";
const PROJECT_ID = "custom-models-project";
const CUSTOM_KEY_ID = "custom-models-provider-key";
const CUSTOM_MODEL_ID = "custom-models-model";
const ADMIN_USER_ID = "custom-models-admin-user";
const ADMIN_EMAIL = "custom-models-admin@example.com";
const DEVELOPER_USER_ID = "custom-models-developer-user";
const DEVELOPER_EMAIL = "custom-models-developer@example.com";

// The scrypt hash from the createTestUser fixture; it hashes the password
// below and is not bound to an email, so it can be reused for other accounts.
const PASSWORD = "admin@example.com1A";
const PASSWORD_HASH =
	"c11ef27a7f9264be08db228ebb650888:a4d985a9c6bd98608237fd507534424950aa7fc255930d972242b81cbe78594f8568feb0d067e95ddf7be242ad3e9d013f695f4414fce68bfff091079f1dc460";

async function createAccountFor(userId: string, email: string) {
	await db.insert(tables.user).values({
		id: userId,
		name: "Custom Models Test User",
		email,
		emailVerified: true,
	});
	await db.insert(tables.account).values({
		id: `${userId}-account`,
		providerId: "credential",
		accountId: `${userId}-account`,
		userId,
		password: PASSWORD_HASH,
	});
}

async function signInAs(email: string) {
	const auth = await app.request("/auth/sign-in/email", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, password: PASSWORD }),
	});
	expect(auth.status).toBe(200);
	return auth.headers.get("set-cookie")!;
}

describe("custom provider/model management role gating", () => {
	let ownerToken: string;
	let adminToken: string;
	let developerToken: string;

	beforeEach(async () => {
		ownerToken = await createTestUser();

		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Custom Models Organization",
			billingEmail: "custom-models@example.com",
			plan: "enterprise",
		});

		await db.insert(tables.userOrganization).values({
			id: `${ORG_ID}-owner-uo`,
			userId: "test-user-id",
			organizationId: ORG_ID,
			role: "owner",
		});

		await createAccountFor(ADMIN_USER_ID, ADMIN_EMAIL);
		await db.insert(tables.userOrganization).values({
			id: `${ORG_ID}-admin-uo`,
			userId: ADMIN_USER_ID,
			organizationId: ORG_ID,
			role: "admin",
		});

		await createAccountFor(DEVELOPER_USER_ID, DEVELOPER_EMAIL);
		await db.insert(tables.userOrganization).values({
			id: `${ORG_ID}-developer-uo`,
			userId: DEVELOPER_USER_ID,
			organizationId: ORG_ID,
			role: "developer",
		});

		await db.insert(tables.project).values({
			id: PROJECT_ID,
			name: "Custom Models Project",
			organizationId: ORG_ID,
		});

		await db.insert(tables.providerKey).values({
			id: CUSTOM_KEY_ID,
			...encryptProviderKeyForStorage(
				"custom-provider-token",
				CUSTOM_KEY_ID,
				ORG_ID,
			),
			provider: "custom",
			name: "myprovider",
			baseUrl: "https://custom.example.com/v1",
			organizationId: ORG_ID,
		});

		await db.insert(tables.customModel).values({
			id: CUSTOM_MODEL_ID,
			providerKeyId: CUSTOM_KEY_ID,
			organizationId: ORG_ID,
			modelName: "my-model",
		});

		adminToken = await signInAs(ADMIN_EMAIL);
		developerToken = await signInAs(DEVELOPER_EMAIL);
	});

	afterEach(async () => {
		await deleteAll();
	});

	function createCustomModel(token: string, modelName: string) {
		return app.request("/custom-models", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({ providerKeyId: CUSTOM_KEY_ID, modelName }),
		});
	}

	function updateCustomModel(token: string) {
		return app.request(`/custom-models/${CUSTOM_MODEL_ID}`, {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({ displayName: "Renamed" }),
		});
	}

	function deleteCustomModel(token: string) {
		return app.request(`/custom-models/${CUSTOM_MODEL_ID}`, {
			method: "DELETE",
			headers: { Cookie: token },
		});
	}

	test("developer can read the custom-model catalog and provider keys", async () => {
		const modelsRes = await app.request("/custom-models", {
			headers: { Cookie: developerToken },
		});
		expect(modelsRes.status).toBe(200);
		const modelsJson = await modelsRes.json();
		expect(modelsJson.customModels).toHaveLength(1);
		expect(modelsJson.customModels[0].id).toBe(CUSTOM_MODEL_ID);

		const keysRes = await app.request("/keys/provider", {
			headers: { Cookie: developerToken },
		});
		expect(keysRes.status).toBe(200);
		const keysJson = await keysRes.json();
		expect(keysJson.providerKeys).toHaveLength(1);
		expect(keysJson.providerKeys[0].maskedToken).toBeDefined();
		expect(keysJson.providerKeys[0].token).toBeUndefined();
	});

	test("developer cannot create a provider key", async () => {
		const res = await app.request("/keys/provider", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: developerToken,
			},
			body: JSON.stringify({
				provider: "custom",
				token: "another-token",
				name: "devprovider",
				baseUrl: "https://dev.example.com/v1",
				organizationId: ORG_ID,
			}),
		});
		expect(res.status).toBe(403);
		const json = await res.json();
		expect(json.message).toContain(
			"Only organization owners and admins can manage provider keys",
		);
	});

	test("developer cannot update or delete a provider key", async () => {
		const patchRes = await app.request(`/keys/provider/${CUSTOM_KEY_ID}`, {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: developerToken,
			},
			body: JSON.stringify({ status: "inactive" }),
		});
		expect(patchRes.status).toBe(404);

		const deleteRes = await app.request(`/keys/provider/${CUSTOM_KEY_ID}`, {
			method: "DELETE",
			headers: { Cookie: developerToken },
		});
		expect(deleteRes.status).toBe(404);

		const key = await db.query.providerKey.findFirst({
			where: { id: { eq: CUSTOM_KEY_ID } },
		});
		expect(key?.status).toBe("active");
	});

	test("developer cannot create, update, or delete a custom model", async () => {
		const createRes = await createCustomModel(developerToken, "dev-model");
		expect(createRes.status).toBe(404);

		const updateRes = await updateCustomModel(developerToken);
		expect(updateRes.status).toBe(404);

		const deleteRes = await deleteCustomModel(developerToken);
		expect(deleteRes.status).toBe(404);

		const model = await db.query.customModel.findFirst({
			where: { id: { eq: CUSTOM_MODEL_ID } },
		});
		expect(model?.status).toBe("active");
		expect(model?.displayName).toBeNull();
	});

	test("admin can create, update, and delete custom models", async () => {
		const createRes = await createCustomModel(adminToken, "admin-model");
		expect(createRes.status).toBe(200);
		const created = await createRes.json();
		expect(created.customModel.modelName).toBe("admin-model");

		const updateRes = await updateCustomModel(adminToken);
		expect(updateRes.status).toBe(200);
		const updated = await updateRes.json();
		expect(updated.customModel.displayName).toBe("Renamed");

		const deleteRes = await deleteCustomModel(adminToken);
		expect(deleteRes.status).toBe(200);

		const model = await db.query.customModel.findFirst({
			where: { id: { eq: CUSTOM_MODEL_ID } },
		});
		expect(model?.status).toBe("deleted");
	});

	test("admin can update a provider key", async () => {
		const res = await app.request(`/keys/provider/${CUSTOM_KEY_ID}`, {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: adminToken,
			},
			body: JSON.stringify({ status: "inactive" }),
		});
		expect(res.status).toBe(200);

		const key = await db.query.providerKey.findFirst({
			where: { id: { eq: CUSTOM_KEY_ID } },
		});
		expect(key?.status).toBe("inactive");
	});

	test("owner can create a custom model", async () => {
		const res = await createCustomModel(ownerToken, "owner-model");
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.customModel.modelName).toBe("owner-model");
	});
});
