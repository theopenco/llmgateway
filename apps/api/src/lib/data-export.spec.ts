import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

import { buildUserDataExport } from "./data-export.js";

const USER_ID = "test-user-id";
const ORG_ID = "test-org-id";
const PROJECT_ID = "test-project-id";

/** Values that must never appear anywhere in an export payload. */
const SECRETS = {
	apiKeyToken: "secret-api-key-token-do-not-export",
	accountPassword: "secret-password-hash-do-not-export",
	accountAccessToken: "secret-access-token-do-not-export",
	accountRefreshToken: "secret-refresh-token-do-not-export",
	sessionToken: "secret-session-token-do-not-export",
};

async function seedUserData() {
	await db.insert(tables.organization).values({
		id: ORG_ID,
		name: "Test Organization",
		billingEmail: "admin@example.com",
	});
	await db.insert(tables.userOrganization).values({
		userId: USER_ID,
		organizationId: ORG_ID,
		role: "owner",
	});
	await db.insert(tables.project).values({
		id: PROJECT_ID,
		name: "Default Project",
		organizationId: ORG_ID,
		mode: "hybrid",
	});
	await db.insert(tables.apiKey).values({
		id: "test-api-key-id",
		token: SECRETS.apiKeyToken,
		description: "My key",
		projectId: PROJECT_ID,
		createdBy: USER_ID,
	});
	await db.insert(tables.account).values({
		id: "export-account-id",
		providerId: "credential",
		accountId: "export-account-id",
		userId: USER_ID,
		password: SECRETS.accountPassword,
		accessToken: SECRETS.accountAccessToken,
		refreshToken: SECRETS.accountRefreshToken,
	});
	await db.insert(tables.session).values({
		id: "export-session-id",
		token: SECRETS.sessionToken,
		userId: USER_ID,
		expiresAt: new Date(Date.now() + 60_000),
		ipAddress: "203.0.113.4",
		userAgent: "vitest",
	});
	await db.insert(tables.chat).values({
		id: "export-chat-id",
		userId: USER_ID,
		title: "My chat",
		model: "gpt-4o-mini",
	});
	await db.insert(tables.message).values({
		id: "export-message-id",
		chatId: "export-chat-id",
		role: "user",
		content: "hello from my chat",
		sequence: 1,
	});
	await db.insert(tables.userFavoriteModel).values({
		userId: USER_ID,
		modelId: "gpt-4o-mini",
	});
}

describe("buildUserDataExport", () => {
	beforeEach(async () => {
		await deleteAll();
		await db.insert(tables.user).values({
			id: USER_ID,
			name: "Test User",
			email: "admin@example.com",
			emailVerified: true,
		});
		await seedUserData();
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("never includes a credential anywhere in the payload", async () => {
		const data = await buildUserDataExport(USER_ID);
		const serialized = JSON.stringify(data);

		for (const [name, secret] of Object.entries(SECRETS)) {
			expect(serialized, `${name} leaked into the export`).not.toContain(
				secret,
			);
		}
	});

	test("includes the profile, memberships and key metadata", async () => {
		const data = (await buildUserDataExport(USER_ID))!;

		expect(data.profile).toMatchObject({
			id: USER_ID,
			email: "admin@example.com",
			name: "Test User",
		});
		expect(data.organizations).toHaveLength(1);
		expect(data.apiKeys).toEqual([
			expect.objectContaining({ description: "My key", status: "active" }),
		]);
	});

	test("includes user-generated content with its messages", async () => {
		const data = (await buildUserDataExport(USER_ID))!;

		const chats = data.chats as { title: string; messages: unknown[] }[];
		expect(chats).toHaveLength(1);
		expect(chats[0].title).toBe("My chat");
		expect(chats[0].messages).toEqual([
			expect.objectContaining({ role: "user", content: "hello from my chat" }),
		]);

		expect(data.preferences).toMatchObject({
			favoriteModels: [expect.objectContaining({ modelId: "gpt-4o-mini" })],
		});
	});

	test("documents what was withheld and why", async () => {
		const data = (await buildUserDataExport(USER_ID))!;

		expect(data.notes.excluded.map((entry) => entry.category)).toContain(
			"Credentials",
		);
		for (const entry of data.notes.excluded) {
			expect(entry).toMatchObject({
				detail: expect.any(String),
				reason: expect.any(String),
			});
		}
	});

	test("reports no truncation for a small account", async () => {
		const data = (await buildUserDataExport(USER_ID))!;
		expect(data.notes.truncated).toEqual([]);
	});

	test("returns nothing for a user that does not exist", async () => {
		expect(await buildUserDataExport("no-such-user")).toBeNull();
	});

	test("does not include another user's data", async () => {
		await db.insert(tables.user).values({
			id: "other-user-id",
			name: "Other User",
			email: "other@example.com",
			emailVerified: true,
		});
		await db.insert(tables.chat).values({
			id: "other-chat-id",
			userId: "other-user-id",
			title: "Other user's private chat",
			model: "gpt-4o-mini",
		});

		const serialized = JSON.stringify(await buildUserDataExport(USER_ID));
		expect(serialized).not.toContain("Other user's private chat");
		expect(serialized).not.toContain("other@example.com");
	});
});

describe("GET /user/me/export", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();
		await seedUserData();
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("returns the export as a named download and refuses to be cached", async () => {
		const res = await app.request("/user/me/export", {
			headers: { Cookie: token },
		});

		expect(res.status).toBe(200);
		expect(res.headers.get("content-disposition")).toBe(
			`attachment; filename="llmgateway-data-export-${USER_ID}.json"`,
		);
		expect(res.headers.get("cache-control")).toBe("no-store");

		const json = await res.json();
		expect(json.subject).toMatchObject({ id: USER_ID });
		expect(json.format).toBe("llmgateway.user-data-export.v1");
		expect(JSON.stringify(json)).not.toContain(SECRETS.apiKeyToken);
	});

	test("rejects an unauthenticated request", async () => {
		const res = await app.request("/user/me/export");
		expect(res.status).toBe(401);
	});
});
