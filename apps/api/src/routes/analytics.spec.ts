import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import {
	aggregateLogsForTesting,
	createTestUser,
	deleteAll,
} from "@/testing.js";

import { db, tables } from "@llmgateway/db";

// A boundary-crossing instant: late evening UTC is already the next calendar
// day in Athens (UTC+2/+3), so the day bucket must differ between the two
// timezones. Matches the reference behaviour tested for the /activity endpoint.
function localDay(date: Date, timeZone: string): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(date);
}

describe("analytics endpoint timezone bucketing", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();

		await db.insert(tables.organization).values({
			id: "test-org-id",
			name: "Test Organization",
			billingEmail: "test@example.com",
			plan: "enterprise",
		});

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

		await db.insert(tables.apiKey).values({
			id: "test-api-key-id",
			token: "test-token",
			projectId: "test-project-id",
			description: "Test API Key",
			createdBy: "test-user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "test-provider-key-id",
			token: "test-provider-token",
			provider: "openai",
			organizationId: "test-org-id",
		});

		const lateUtc = new Date();
		lateUtc.setUTCDate(lateUtc.getUTCDate() - 1);
		lateUtc.setUTCHours(23, 30, 0, 0);

		await db.insert(tables.log).values({
			id: "tz-analytics-1",
			requestId: "tz-analytics-1",
			createdAt: lateUtc,
			updatedAt: lateUtc,
			organizationId: "test-org-id",
			projectId: "test-project-id",
			apiKeyId: "test-api-key-id",
			duration: 100,
			requestedModel: "gpt-4",
			requestedProvider: "openai",
			usedModel: "gpt-4",
			usedProvider: "openai",
			responseSize: 1000,
			promptTokens: "10",
			completionTokens: "20",
			totalTokens: "30",
			cost: 0.12,
			messages: JSON.stringify([{ role: "user", content: "Test" }]),
			mode: "api-keys",
			usedMode: "api-keys",
		});

		await aggregateLogsForTesting();
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("GET /analytics/activity buckets the day in the requested timezone", async () => {
		const lateUtc = new Date();
		lateUtc.setUTCDate(lateUtc.getUTCDate() - 1);
		lateUtc.setUTCHours(23, 30, 0, 0);

		const utcRes = await app.request(
			"/analytics/activity?organizationId=test-org-id&timezone=UTC",
			{ headers: { Cookie: token } },
		);
		expect(utcRes.status).toBe(200);
		const utcData = await utcRes.json();
		const utcActive = utcData.activity.filter(
			(row: { requestCount: number }) => row.requestCount > 0,
		);
		expect(utcActive).toHaveLength(1);
		expect(utcActive[0].date).toBe(localDay(lateUtc, "UTC"));

		const athensRes = await app.request(
			"/analytics/activity?organizationId=test-org-id&timezone=Europe/Athens",
			{ headers: { Cookie: token } },
		);
		expect(athensRes.status).toBe(200);
		const athensData = await athensRes.json();
		const athensActive = athensData.activity.filter(
			(row: { requestCount: number }) => row.requestCount > 0,
		);
		expect(athensActive).toHaveLength(1);
		expect(athensActive[0].date).toBe(localDay(lateUtc, "Europe/Athens"));
		expect(athensActive[0].date).not.toBe(utcActive[0].date);
	});

	test("GET /analytics/activity rejects an invalid timezone", async () => {
		const res = await app.request(
			"/analytics/activity?organizationId=test-org-id&timezone=Not/AZone",
			{ headers: { Cookie: token } },
		);
		expect(res.status).toBe(400);
	});

	test("GET /analytics/me buckets the day in the requested timezone", async () => {
		const lateUtc = new Date();
		lateUtc.setUTCDate(lateUtc.getUTCDate() - 1);
		lateUtc.setUTCHours(23, 30, 0, 0);

		const utcRes = await app.request(
			"/analytics/me?organizationId=test-org-id&projectId=test-project-id&timezone=UTC",
			{ headers: { Cookie: token } },
		);
		expect(utcRes.status).toBe(200);
		const utcData = await utcRes.json();
		const utcActive = utcData.activity.filter(
			(row: { requestCount: number }) => row.requestCount > 0,
		);
		expect(utcActive).toHaveLength(1);
		expect(utcActive[0].date).toBe(localDay(lateUtc, "UTC"));

		const athensRes = await app.request(
			"/analytics/me?organizationId=test-org-id&projectId=test-project-id&timezone=Europe/Athens",
			{ headers: { Cookie: token } },
		);
		expect(athensRes.status).toBe(200);
		const athensData = await athensRes.json();
		const athensActive = athensData.activity.filter(
			(row: { requestCount: number }) => row.requestCount > 0,
		);
		expect(athensActive).toHaveLength(1);
		expect(athensActive[0].date).toBe(localDay(lateUtc, "Europe/Athens"));
		expect(athensActive[0].date).not.toBe(utcActive[0].date);
	});
});
