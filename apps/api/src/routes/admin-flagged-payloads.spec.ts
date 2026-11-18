import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";
import { getFlaggedPayloadExpiry } from "@llmgateway/shared/flagged-payload";
import { encryptFlaggedPayload } from "@llmgateway/shared/flagged-payload-crypto";

const ORG_ID = "flagged-payload-org";
const ROW_ID = "flagged-payload-row";
const BASE = "/admin/content-filter/flagged-payloads";
const YEAR_MS = 365 * 86_400_000;
const PROMPT = "the prompt the classifier flagged";

async function seedPayload(createdAt = new Date()) {
	await db.insert(tables.organization).values({
		id: ORG_ID,
		name: "Flagged Org",
		billingEmail: "flagged@test.example",
	});
	await db.insert(tables.contentFilterFlaggedPayload).values({
		id: ROW_ID,
		createdAt,
		requestId: "req-flagged",
		organizationId: ORG_ID,
		projectId: "project-flagged",
		apiKeyId: "key-flagged",
		endpoint: "chat",
		provider: "openai",
		model: "gpt-4o",
		classifier: "openai",
		tier: 0,
		level: "strict",
		action: "blocked",
		matchedGroups: ["csam"],
		matchedCategories: ["sexual/minors"],
		categoryScores: { "sexual/minors": 0.42 },
		payloadCiphertext: encryptFlaggedPayload(
			JSON.stringify({
				version: 1,
				droppedMessages: 0,
				messages: [{ role: "user", content: PROMPT }],
			}),
			ROW_ID,
			ORG_ID,
		),
		payloadBytes: 100,
		expiresAt: getFlaggedPayloadExpiry(createdAt),
	});
}

async function platformAudit() {
	return await db
		.select()
		.from(tables.platformAuditLog)
		.where(
			eq(
				tables.platformAuditLog.resourceType,
				"content_filter_flagged_payload",
			),
		);
}

describe("admin flagged payloads", () => {
	let cookie: string;

	const request = async (
		path: string,
		method = "GET",
		body?: Record<string, unknown>,
	) =>
		await app.request(path, {
			method,
			headers: {
				Cookie: cookie,
				...(body ? { "Content-Type": "application/json" } : {}),
			},
			...(body ? { body: JSON.stringify(body) } : {}),
		});

	beforeEach(async () => {
		vi.stubEnv("ADMIN_FULL_ACCESS_EMAILS", "admin@example.com");
		vi.stubEnv("ADMIN_SUPPORT_EMAILS", "");
		vi.stubEnv("ADMIN_VIEWER_EMAILS", "");
		cookie = await createTestUser();
		await seedPayload();
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
		await deleteAll();
	});

	test("lists metadata only and audit-logs the listing", async () => {
		const res = await request(`${BASE}?organizationId=${ORG_ID}`);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.total).toBe(1);
		expect(body.items[0]).toMatchObject({
			id: ROW_ID,
			organizationName: "Flagged Org",
			matchedGroups: ["csam"],
			reportedAt: null,
		});
		expect(JSON.stringify(body).includes(PROMPT)).toBe(false);
		expect(JSON.stringify(body).includes("payloadCiphertext")).toBe(false);

		const audit = await platformAudit();
		expect(audit).toHaveLength(1);
		expect(audit[0]).toMatchObject({
			action: "content_filter_flagged_payload.list",
			userId: "test-user-id",
			metadata: { actorEmail: "admin@example.com", organizationId: ORG_ID },
		});
	});

	test("decrypts on view and records the view first", async () => {
		const res = await request(`${BASE}/${ROW_ID}`);
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("no-store");
		const body = await res.json();
		expect(body.payload.messages).toEqual([{ role: "user", content: PROMPT }]);

		const audit = await platformAudit();
		expect(audit).toHaveLength(1);
		expect(audit[0]).toMatchObject({
			action: "content_filter_flagged_payload.view",
			resourceId: ROW_ID,
			metadata: { organizationId: ORG_ID },
		});
		// Staff access never appears in the customer's own audit log.
		const customerAudit = await db
			.select()
			.from(tables.auditLog)
			.where(eq(tables.auditLog.organizationId, ORG_ID));
		expect(customerAudit).toHaveLength(0);
	});

	test("returns 404 for an unknown payload", async () => {
		expect((await request(`${BASE}/missing`)).status).toBe(404);
	});

	test("marking reported holds the payload for a year from the first report", async () => {
		const res = await request(`${BASE}/${ROW_ID}/report`, "POST", {
			reportReference: "CT-1",
		});
		expect(res.status).toBe(200);
		const { item } = await res.json();
		expect(item.reportReference).toBe("CT-1");
		const reportedAt = new Date(item.reportedAt).getTime();
		expect(new Date(item.expiresAt).getTime()).toBe(reportedAt + YEAR_MS);

		const again = await request(`${BASE}/${ROW_ID}/report`, "POST", {
			reportReference: "CT-2",
		});
		const updated = (await again.json()).item;
		expect(updated.reportReference).toBe("CT-2");
		expect(updated.reportedAt).toBe(item.reportedAt);
		expect(updated.expiresAt).toBe(item.expiresAt);

		const actions = (await platformAudit()).map((entry) => entry.action);
		expect(actions).toEqual([
			"content_filter_flagged_payload.report",
			"content_filter_flagged_payload.report",
		]);
	});

	test("rejects an empty report reference", async () => {
		const res = await request(`${BASE}/${ROW_ID}/report`, "POST", {
			reportReference: "  ",
		});
		expect(res.status).toBe(400);
	});

	for (const role of ["support", "viewer"] as const) {
		test(`refuses the ${role} role on every route`, async () => {
			vi.stubEnv("ADMIN_FULL_ACCESS_EMAILS", "");
			vi.stubEnv(
				role === "support" ? "ADMIN_SUPPORT_EMAILS" : "ADMIN_VIEWER_EMAILS",
				"admin@example.com",
			);
			expect((await request(BASE)).status).toBe(403);
			expect((await request(`${BASE}/${ROW_ID}`)).status).toBe(403);
			expect(
				(
					await request(`${BASE}/${ROW_ID}/report`, "POST", {
						reportReference: "CT-1",
					})
				).status,
			).toBe(403);
			expect(await platformAudit()).toHaveLength(0);
		});
	}

	test("refuses non-admins", async () => {
		vi.stubEnv("ADMIN_FULL_ACCESS_EMAILS", "");
		expect((await request(`${BASE}/${ROW_ID}`)).status).toBe(403);
	});
});
