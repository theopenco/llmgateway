import { db, tables } from "@llmgateway/db";

import { app } from ".";
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths
import { clearCache } from "../../gateway/src/test-utils/test-helpers";

import type { OpenAPIHono } from "@hono/zod-openapi";

const credentials = {
	email: "admin@example.com",
	password: "admin@example.com1A",
};

export async function deleteAll() {
	await clearCache();

	await Promise.all([
		db.delete(tables.log),
		db.delete(tables.apiKey),
		db.delete(tables.providerKey),
	]);

	await Promise.all([
		db.delete(tables.userOrganization),
		db.delete(tables.project),
	]);

	await Promise.all([
		db.delete(tables.organization),
		db.delete(tables.user),
		db.delete(tables.account),
		db.delete(tables.session),
		db.delete(tables.verification),
	]);
}

export async function createTestUser() {
	await deleteAll();

	// Create test user
	await db.insert(tables.user).values({
		id: "test-user-id",
		name: "Test User",
		email: "admin@example.com",
		emailVerified: true,
	});

	// Create test account
	await db.insert(tables.account).values({
		id: "test-account-id",
		providerId: "credential",
		accountId: "test-account-id",
		userId: "test-user-id",
		password:
			"c11ef27a7f9264be08db228ebb650888:a4d985a9c6bd98608237fd507534424950aa7fc255930d972242b81cbe78594f8568feb0d067e95ddf7be242ad3e9d013f695f4414fce68bfff091079f1dc460",
	});

	return await getTestToken(app);
}

export async function getTestToken(app: OpenAPIHono<any>) {
	const auth = await app.request("/auth/sign-in/email", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(credentials),
	});
	if (auth.status !== 200) {
		throw new Error(`Failed to authenticate: ${auth.status}`);
	}
	return auth.headers.get("set-cookie")!;
}
