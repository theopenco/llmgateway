import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

const originalAdminEmails = process.env.ADMIN_EMAILS;

const ORG_ID = "seat-logs-org";
const PROJECT_A = "seat-logs-project-a";
const PROJECT_B = "seat-logs-project-b";

const ALICE_EMAIL = "Alice.Seat@seat-logs.example";
const BOB_EMAIL = "bob.seat@seat-logs.example";

interface LogsBody {
	logs: {
		id: string;
		projectId: string;
		projectName: string | null;
		apiKeyId: string;
		apiKeyName: string | null;
		apiKeyUserEmail: string | null;
	}[];
	pagination: { nextCursor: string | null; hasMore: boolean; limit: number };
}

async function getLogs(path: string, cookie: string): Promise<Response> {
	return await app.request(`/admin/organizations/${ORG_ID}${path}`, {
		headers: { Cookie: cookie },
	});
}

async function seedLog(id: string, projectId: string, apiKeyId: string) {
	await db.insert(tables.log).values({
		id,
		requestId: `${id}-request`,
		organizationId: ORG_ID,
		projectId,
		apiKeyId,
		duration: 100,
		requestedModel: "gpt-4o-mini",
		usedModel: "openai/gpt-4o-mini",
		usedProvider: "openai",
		responseSize: 10,
		mode: "credits",
		usedMode: "credits",
	});
}

describe("admin organization and project logs", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();

		await db.insert(tables.user).values([
			{
				id: "seat-logs-alice",
				name: "Alice Seat",
				email: ALICE_EMAIL,
				emailVerified: true,
			},
			{
				id: "seat-logs-bob",
				name: "Bob Seat",
				email: BOB_EMAIL,
				emailVerified: true,
			},
		]);
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Seat Logs Org",
			billingEmail: "seat-logs@example.com",
		});
		await db.insert(tables.project).values([
			{
				id: PROJECT_A,
				name: "Project A",
				organizationId: ORG_ID,
				mode: "credits",
			},
			{
				id: PROJECT_B,
				name: "Project B",
				organizationId: ORG_ID,
				mode: "credits",
			},
		]);
		await db.insert(tables.apiKey).values([
			{
				id: "seat-logs-alice-key",
				...hashApiKeyForStorage("seat-logs-alice-token"),
				projectId: PROJECT_A,
				description: "Alice key",
				createdBy: "seat-logs-alice",
			},
			{
				id: "seat-logs-alice-key-b",
				...hashApiKeyForStorage("seat-logs-alice-token-b"),
				projectId: PROJECT_B,
				description: "Alice key B",
				createdBy: "seat-logs-alice",
			},
			{
				id: "seat-logs-bob-key",
				...hashApiKeyForStorage("seat-logs-bob-token"),
				projectId: PROJECT_A,
				description: "Bob key",
				createdBy: "seat-logs-bob",
			},
		]);

		await seedLog("seat-logs-1", PROJECT_A, "seat-logs-alice-key");
		await seedLog("seat-logs-2", PROJECT_A, "seat-logs-bob-key");
		await seedLog("seat-logs-3", PROJECT_B, "seat-logs-alice-key-b");
	});

	afterEach(async () => {
		if (originalAdminEmails === undefined) {
			delete process.env.ADMIN_EMAILS;
		} else {
			process.env.ADMIN_EMAILS = originalAdminEmails;
		}
		await deleteAll();
	});

	it("rejects unauthenticated requests", async () => {
		const res = await app.request(`/admin/organizations/${ORG_ID}/logs`);
		expect(res.status).toBe(401);
	});

	it("returns every project's logs with key-owner attribution", async () => {
		const res = await getLogs("/logs", cookie);
		expect(res.status).toBe(200);
		const body = (await res.json()) as LogsBody;
		expect(body.logs.map((l) => l.id).sort()).toEqual([
			"seat-logs-1",
			"seat-logs-2",
			"seat-logs-3",
		]);

		const alice = body.logs.find((l) => l.id === "seat-logs-1")!;
		expect(alice.apiKeyUserEmail).toBe(ALICE_EMAIL);
		expect(alice.apiKeyName).toBe("Alice key");
		expect(alice.projectName).toBe("Project A");
	});

	it("filters organization logs by seat email, case-insensitively", async () => {
		const res = await getLogs(
			`/logs?userEmail=${encodeURIComponent(ALICE_EMAIL.toLowerCase())}`,
			cookie,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as LogsBody;
		expect(body.logs.map((l) => l.id).sort()).toEqual([
			"seat-logs-1",
			"seat-logs-3",
		]);
	});

	it("combines the seat filter with a project filter", async () => {
		const res = await getLogs(
			`/logs?userEmail=${encodeURIComponent(ALICE_EMAIL)}&projectId=${PROJECT_B}`,
			cookie,
		);
		const body = (await res.json()) as LogsBody;
		expect(body.logs.map((l) => l.id)).toEqual(["seat-logs-3"]);
	});

	it("returns nothing for an email with no keys in the organization", async () => {
		const res = await getLogs(
			"/logs?userEmail=nobody@seat-logs.example",
			cookie,
		);
		const body = (await res.json()) as LogsBody;
		expect(body.logs).toEqual([]);
	});

	it("filters project logs by seat email", async () => {
		const res = await getLogs(
			`/projects/${PROJECT_A}/logs?userEmail=${encodeURIComponent(BOB_EMAIL)}`,
			cookie,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as LogsBody;
		expect(body.logs.map((l) => l.id)).toEqual(["seat-logs-2"]);
		expect(body.logs[0].apiKeyUserEmail).toBe(BOB_EMAIL);
	});

	it("404s for an unknown organization", async () => {
		const res = await app.request("/admin/organizations/does-not-exist/logs", {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(404);
	});
});
