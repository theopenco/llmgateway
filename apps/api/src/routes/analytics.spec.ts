import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import {
	aggregateLogsForTesting,
	createTestUser,
	deleteAll,
} from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

const OWNER_ID = "test-user-id";
const MEMBER_ID = "member-2-id";
const ORG_ID = "test-org-id";
const PROJECT_ID = "test-project-id";

function localDay(date: Date, timeZone: string): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(date);
}

// A single instant reused for every fixture log so day-bucket assertions are
// deterministic (no "runs near midnight" flake) and always inside the default
// 7-day window (logTime <= now).
let logTime: Date;

interface LogOverrides {
	id: string;
	apiKeyId: string;
	usedModel: string;
	usedProvider: string;
	cost: number;
	promptTokens: string;
	completionTokens: string;
	totalTokens: string;
	hasError?: boolean;
	cached?: boolean;
}

function insertLog(o: LogOverrides) {
	return db.insert(tables.log).values({
		id: o.id,
		requestId: o.id,
		createdAt: logTime,
		updatedAt: logTime,
		organizationId: ORG_ID,
		projectId: PROJECT_ID,
		apiKeyId: o.apiKeyId,
		duration: 100,
		requestedModel: o.usedModel,
		requestedProvider: o.usedProvider,
		usedModel: o.usedModel,
		usedProvider: o.usedProvider,
		responseSize: 1000,
		promptTokens: o.promptTokens,
		completionTokens: o.completionTokens,
		totalTokens: o.totalTokens,
		cost: o.cost,
		hasError: o.hasError ?? false,
		cached: o.cached ?? false,
		messages: JSON.stringify([{ role: "user", content: "Test" }]),
		mode: "api-keys",
		usedMode: "api-keys",
	});
}

describe("analytics endpoints", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();
		logTime = new Date();

		await db.insert(tables.user).values({
			id: MEMBER_ID,
			name: "Member Two",
			email: "member2@example.com",
			emailVerified: true,
		});

		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Test Organization",
			billingEmail: "test@example.com",
			plan: "enterprise",
		});

		await db.insert(tables.userOrganization).values([
			{
				id: "uo-owner",
				userId: OWNER_ID,
				organizationId: ORG_ID,
				role: "owner",
			},
			{
				id: "uo-member",
				userId: MEMBER_ID,
				organizationId: ORG_ID,
				role: "developer",
			},
		]);

		await db.insert(tables.project).values({
			id: PROJECT_ID,
			name: "Test Project",
			organizationId: ORG_ID,
		});

		await db.insert(tables.providerKey).values({
			id: "test-provider-key-id",
			token: "test-provider-token",
			provider: "openai",
			organizationId: ORG_ID,
		});

		await db.insert(tables.apiKey).values([
			{
				id: "key-owner",
				token: "token-owner",
				projectId: PROJECT_ID,
				description: "Owner Key",
				createdBy: OWNER_ID,
			},
			{
				id: "key-member",
				token: "token-member",
				projectId: PROJECT_ID,
				description: "Member Key",
				createdBy: MEMBER_ID,
			},
		]);

		// Owner: 2 requests, 1 error, 1 cache hit, cost 0.30, 70 total tokens.
		await insertLog({
			id: "log-owner-1",
			apiKeyId: "key-owner",
			usedModel: "gpt-4",
			usedProvider: "openai",
			cost: 0.1,
			promptTokens: "10",
			completionTokens: "20",
			totalTokens: "30",
			hasError: true,
		});
		await insertLog({
			id: "log-owner-2",
			apiKeyId: "key-owner",
			usedModel: "gpt-4",
			usedProvider: "openai",
			cost: 0.2,
			promptTokens: "15",
			completionTokens: "25",
			totalTokens: "40",
			cached: true,
		});
		// Member: 1 request, cost 0.05, 10 total tokens, different model/provider.
		await insertLog({
			id: "log-member-1",
			apiKeyId: "key-member",
			usedModel: "claude-3-5-sonnet",
			usedProvider: "anthropic",
			cost: 0.05,
			promptTokens: "5",
			completionTokens: "5",
			totalTokens: "10",
		});

		await aggregateLogsForTesting();
	});

	afterEach(async () => {
		await deleteAll();
	});

	interface ActivitySeriesRow {
		date: string;
		cost: number;
		requestCount: number;
		totalTokens: number;
		breakdown: { key: string; label: string; cost: number }[];
	}

	function activeRows(rows: ActivitySeriesRow[]): ActivitySeriesRow[] {
		return rows.filter((r) => r.requestCount > 0);
	}

	describe("GET /analytics/members", () => {
		test("returns per-member usage sorted by cost desc", async () => {
			const res = await app.request(
				`/analytics/members?organizationId=${ORG_ID}`,
				{ headers: { Cookie: token } },
			);
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.plan).toBe("enterprise");
			expect(data.members).toHaveLength(2);

			// Owner (0.30) outspends member (0.05), so it must sort first.
			const [first, second] = data.members;
			expect(first.userId).toBe(OWNER_ID);
			expect(first.cost).toBeCloseTo(0.3, 5);
			expect(first.requestCount).toBe(2);
			expect(first.errorCount).toBe(1);
			expect(first.totalTokens).toBe(70);
			expect(first.apiKeyCount).toBe(1);

			expect(second.userId).toBe(MEMBER_ID);
			expect(second.cost).toBeCloseTo(0.05, 5);
			expect(second.requestCount).toBe(1);
			expect(second.apiKeyCount).toBe(1);
		});

		test("returns zeroed members when the org has no projects", async () => {
			await db
				.delete(tables.project)
				.where(eq(tables.project.organizationId, ORG_ID));

			const res = await app.request(
				`/analytics/members?organizationId=${ORG_ID}`,
				{ headers: { Cookie: token } },
			);
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.members).toHaveLength(2);
			for (const m of data.members) {
				expect(m.cost).toBe(0);
				expect(m.requestCount).toBe(0);
				expect(m.apiKeyCount).toBe(0);
			}
		});

		test("requires authentication", async () => {
			const res = await app.request(
				`/analytics/members?organizationId=${ORG_ID}`,
			);
			expect(res.status).toBe(401);
		});

		test("rejects a non-member with 403", async () => {
			await db
				.delete(tables.userOrganization)
				.where(eq(tables.userOrganization.userId, OWNER_ID));

			const res = await app.request(
				`/analytics/members?organizationId=${ORG_ID}`,
				{ headers: { Cookie: token } },
			);
			expect(res.status).toBe(403);
		});

		test("rejects a developer with 403", async () => {
			await db
				.update(tables.userOrganization)
				.set({ role: "developer" })
				.where(eq(tables.userOrganization.userId, OWNER_ID));

			const res = await app.request(
				`/analytics/members?organizationId=${ORG_ID}`,
				{ headers: { Cookie: token } },
			);
			expect(res.status).toBe(403);
		});

		test("rejects a non-enterprise plan with 403", async () => {
			await db
				.update(tables.organization)
				.set({ plan: "pro" })
				.where(eq(tables.organization.id, ORG_ID));

			const res = await app.request(
				`/analytics/members?organizationId=${ORG_ID}`,
				{ headers: { Cookie: token } },
			);
			expect(res.status).toBe(403);
		});

		test("returns 404 for a deleted organization", async () => {
			await db
				.update(tables.organization)
				.set({ status: "deleted" })
				.where(eq(tables.organization.id, ORG_ID));

			const res = await app.request(
				`/analytics/members?organizationId=${ORG_ID}`,
				{ headers: { Cookie: token } },
			);
			expect(res.status).toBe(404);
		});

		test("rejects an invalid from/to with 400", async () => {
			const res = await app.request(
				`/analytics/members?organizationId=${ORG_ID}&from=nope&to=alsonope`,
				{ headers: { Cookie: token } },
			);
			expect(res.status).toBe(400);
		});
	});

	describe("GET /analytics/members/{userId}", () => {
		test("returns detailed usage for a member", async () => {
			const res = await app.request(
				`/analytics/members/${OWNER_ID}?organizationId=${ORG_ID}`,
				{ headers: { Cookie: token } },
			);
			expect(res.status).toBe(200);
			const data = await res.json();

			expect(data.member.userId).toBe(OWNER_ID);
			expect(data.member.role).toBe("owner");

			expect(data.summary.cost).toBeCloseTo(0.3, 5);
			expect(data.summary.requestCount).toBe(2);
			expect(data.summary.errorCount).toBe(1);
			expect(data.summary.cacheCount).toBe(1);
			expect(data.summary.totalTokens).toBe(70);
			expect(data.summary.apiKeyCount).toBe(1);

			expect(data.costByModel[0].key).toBe("gpt-4");
			expect(data.topModels[0].key).toBe("gpt-4");
			expect(data.topProviders[0].key).toBe("openai");

			const active = data.activity.filter(
				(r: { modelBreakdown: unknown[] }) => r.modelBreakdown.length > 0,
			);
			expect(active).toHaveLength(1);
			expect(active[0].date).toBe(localDay(logTime, "UTC"));
			expect(active[0].modelBreakdown[0].id).toBe("gpt-4");
			expect(active[0].modelBreakdown[0].provider).toBe("openai");
		});

		test("pads a window that has no usage with empty days", async () => {
			// The member's only log is "now", outside the Jan 2024 window, so the
			// summary is zero and every returned day is padded empty.
			const res = await app.request(
				`/analytics/members/${MEMBER_ID}?organizationId=${ORG_ID}&from=2024-01-01&to=2024-01-03`,
				{ headers: { Cookie: token } },
			);
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.summary.cost).toBe(0);
			expect(data.summary.requestCount).toBe(0);
			expect(data.activity).toHaveLength(3);
			for (const row of data.activity) {
				expect(row.modelBreakdown).toEqual([]);
			}
		});

		test("returns 404 for a non-member userId", async () => {
			const res = await app.request(
				`/analytics/members/not-a-member?organizationId=${ORG_ID}`,
				{ headers: { Cookie: token } },
			);
			expect(res.status).toBe(404);
		});

		test("rejects a range larger than the max window with 400", async () => {
			const res = await app.request(
				`/analytics/members/${OWNER_ID}?organizationId=${ORG_ID}&from=2020-01-01&to=2024-01-01`,
				{ headers: { Cookie: token } },
			);
			expect(res.status).toBe(400);
		});

		test("enforces the enterprise-admin gate", async () => {
			await db
				.update(tables.userOrganization)
				.set({ role: "developer" })
				.where(eq(tables.userOrganization.userId, OWNER_ID));

			const res = await app.request(
				`/analytics/members/${OWNER_ID}?organizationId=${ORG_ID}`,
				{ headers: { Cookie: token } },
			);
			expect(res.status).toBe(403);
		});
	});

	describe("GET /analytics/activity", () => {
		test("groups by model with org-wide totals (default)", async () => {
			const res = await app.request(
				`/analytics/activity?organizationId=${ORG_ID}`,
				{ headers: { Cookie: token } },
			);
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.groupBy).toBe("model");

			const active = activeRows(data.activity);
			expect(active).toHaveLength(1);
			const day = active[0];
			expect(day.date).toBe(localDay(logTime, "UTC"));
			expect(day.cost).toBeCloseTo(0.35, 5);
			expect(day.requestCount).toBe(3);

			const byKey = new Map(
				day.breakdown.map((b: { key: string; cost: number }) => [b.key, b]),
			);
			expect((byKey.get("gpt-4") as { cost: number }).cost).toBeCloseTo(0.3, 5);
			expect(
				(byKey.get("claude-3-5-sonnet") as { cost: number }).cost,
			).toBeCloseTo(0.05, 5);
		});

		test("groups by project", async () => {
			const res = await app.request(
				`/analytics/activity?organizationId=${ORG_ID}&groupBy=project`,
				{ headers: { Cookie: token } },
			);
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.groupBy).toBe("project");

			const day = activeRows(data.activity)[0];
			expect(day.breakdown).toHaveLength(1);
			expect(day.breakdown[0].key).toBe(PROJECT_ID);
			expect(day.breakdown[0].label).toBe("Test Project");
			expect(day.breakdown[0].cost).toBeCloseTo(0.35, 5);
		});

		test("groups by user (attributed via api_key.created_by)", async () => {
			const res = await app.request(
				`/analytics/activity?organizationId=${ORG_ID}&groupBy=user`,
				{ headers: { Cookie: token } },
			);
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.groupBy).toBe("user");

			const day = activeRows(data.activity)[0];
			const byKey = new Map(
				day.breakdown.map((b: { key: string; label: string; cost: number }) => [
					b.key,
					b,
				]),
			);
			expect((byKey.get(OWNER_ID) as { label: string }).label).toBe(
				"Test User",
			);
			expect((byKey.get(OWNER_ID) as { cost: number }).cost).toBeCloseTo(
				0.3,
				5,
			);
			expect((byKey.get(MEMBER_ID) as { label: string }).label).toBe(
				"Member Two",
			);
			expect((byKey.get(MEMBER_ID) as { cost: number }).cost).toBeCloseTo(
				0.05,
				5,
			);
		});

		test("groups by apiKey", async () => {
			const res = await app.request(
				`/analytics/activity?organizationId=${ORG_ID}&groupBy=apiKey`,
				{ headers: { Cookie: token } },
			);
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.groupBy).toBe("apiKey");

			const day = activeRows(data.activity)[0];
			const byKey = new Map(
				day.breakdown.map((b: { key: string; label: string; cost: number }) => [
					b.key,
					b,
				]),
			);
			expect((byKey.get("key-owner") as { label: string }).label).toBe(
				"Owner Key",
			);
			expect((byKey.get("key-member") as { label: string }).label).toBe(
				"Member Key",
			);
		});

		test("returns a zeroed padded series when the org has no projects", async () => {
			await db
				.delete(tables.project)
				.where(eq(tables.project.organizationId, ORG_ID));

			const res = await app.request(
				`/analytics/activity?organizationId=${ORG_ID}&from=2024-01-01&to=2024-01-03`,
				{ headers: { Cookie: token } },
			);
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.activity).toHaveLength(3);
			for (const row of data.activity) {
				expect(row.cost).toBe(0);
				expect(row.requestCount).toBe(0);
				expect(row.breakdown).toEqual([]);
			}
		});

		test("rejects a range larger than the max window with 400", async () => {
			const res = await app.request(
				`/analytics/activity?organizationId=${ORG_ID}&from=2020-01-01&to=2024-01-01`,
				{ headers: { Cookie: token } },
			);
			expect(res.status).toBe(400);
		});

		test("rejects an invalid from/to with 400", async () => {
			const res = await app.request(
				`/analytics/activity?organizationId=${ORG_ID}&from=bad&to=worse`,
				{ headers: { Cookie: token } },
			);
			expect(res.status).toBe(400);
		});

		test("requires authentication", async () => {
			const res = await app.request(
				`/analytics/activity?organizationId=${ORG_ID}`,
			);
			expect(res.status).toBe(401);
		});

		test("enforces the enterprise-admin gate", async () => {
			await db
				.update(tables.organization)
				.set({ plan: "pro" })
				.where(eq(tables.organization.id, ORG_ID));

			const res = await app.request(
				`/analytics/activity?organizationId=${ORG_ID}`,
				{ headers: { Cookie: token } },
			);
			expect(res.status).toBe(403);
		});

		test("buckets the day in the requested timezone", async () => {
			const boundary = new Date();
			boundary.setUTCDate(boundary.getUTCDate() - 1);
			boundary.setUTCHours(23, 30, 0, 0);
			await db.delete(tables.log);
			await insertLog({
				id: "log-tz",
				apiKeyId: "key-owner",
				usedModel: "gpt-4",
				usedProvider: "openai",
				cost: 0.01,
				promptTokens: "1",
				completionTokens: "1",
				totalTokens: "2",
			});
			await db
				.update(tables.log)
				.set({ createdAt: boundary, updatedAt: boundary })
				.where(eq(tables.log.id, "log-tz"));
			await aggregateLogsForTesting();

			const utcRes = await app.request(
				`/analytics/activity?organizationId=${ORG_ID}&timezone=UTC`,
				{ headers: { Cookie: token } },
			);
			const utcDay = activeRows((await utcRes.json()).activity)[0];
			expect(utcDay.date).toBe(localDay(boundary, "UTC"));

			const athensRes = await app.request(
				`/analytics/activity?organizationId=${ORG_ID}&timezone=Europe/Athens`,
				{ headers: { Cookie: token } },
			);
			const athensDay = activeRows((await athensRes.json()).activity)[0];
			expect(athensDay.date).toBe(localDay(boundary, "Europe/Athens"));
			expect(athensDay.date).not.toBe(utcDay.date);
		});

		test("rejects an invalid timezone with 400", async () => {
			const res = await app.request(
				`/analytics/activity?organizationId=${ORG_ID}&timezone=Not/AZone`,
				{ headers: { Cookie: token } },
			);
			expect(res.status).toBe(400);
		});
	});

	describe("GET /analytics/me", () => {
		test("returns only the authenticated user's own usage", async () => {
			const res = await app.request(
				`/analytics/me?organizationId=${ORG_ID}&projectId=${PROJECT_ID}`,
				{ headers: { Cookie: token } },
			);
			expect(res.status).toBe(200);
			const data = await res.json();

			// Owner-only: excludes the member's 0.05 spend in the same project.
			expect(data.summary.cost).toBeCloseTo(0.3, 5);
			expect(data.summary.requestCount).toBe(2);
			expect(data.summary.errorCount).toBe(1);
			expect(data.summary.apiKeyCount).toBe(1);

			expect(data.topModels[0].key).toBe("gpt-4");

			const day = activeRows(data.activity)[0];
			expect(day.date).toBe(localDay(logTime, "UTC"));
			expect(day.cost).toBeCloseTo(0.3, 5);
		});

		test("returns a zeroed series when the user has no keys in the project", async () => {
			await db
				.delete(tables.apiKey)
				.where(eq(tables.apiKey.createdBy, OWNER_ID));

			const res = await app.request(
				`/analytics/me?organizationId=${ORG_ID}&projectId=${PROJECT_ID}&from=2024-01-01&to=2024-01-02`,
				{ headers: { Cookie: token } },
			);
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.summary.cost).toBe(0);
			expect(data.topModels).toEqual([]);
			expect(data.activity).toHaveLength(2);
			for (const row of data.activity) {
				expect(row.cost).toBe(0);
			}
		});

		test("returns 403 without project access", async () => {
			const res = await app.request(
				`/analytics/me?organizationId=${ORG_ID}&projectId=no-such-project`,
				{ headers: { Cookie: token } },
			);
			expect(res.status).toBe(403);
		});

		test("requires authentication", async () => {
			const res = await app.request(
				`/analytics/me?organizationId=${ORG_ID}&projectId=${PROJECT_ID}`,
			);
			expect(res.status).toBe(401);
		});

		test("rejects a range larger than the max window with 400", async () => {
			const res = await app.request(
				`/analytics/me?organizationId=${ORG_ID}&projectId=${PROJECT_ID}&from=2020-01-01&to=2024-01-01`,
				{ headers: { Cookie: token } },
			);
			expect(res.status).toBe(400);
		});

		test("buckets the day in the requested timezone", async () => {
			const boundary = new Date();
			boundary.setUTCDate(boundary.getUTCDate() - 1);
			boundary.setUTCHours(23, 30, 0, 0);
			await db.delete(tables.log);
			await insertLog({
				id: "log-tz-me",
				apiKeyId: "key-owner",
				usedModel: "gpt-4",
				usedProvider: "openai",
				cost: 0.01,
				promptTokens: "1",
				completionTokens: "1",
				totalTokens: "2",
			});
			await db
				.update(tables.log)
				.set({ createdAt: boundary, updatedAt: boundary })
				.where(eq(tables.log.id, "log-tz-me"));
			await aggregateLogsForTesting();

			const utcRes = await app.request(
				`/analytics/me?organizationId=${ORG_ID}&projectId=${PROJECT_ID}&timezone=UTC`,
				{ headers: { Cookie: token } },
			);
			const utcDay = activeRows((await utcRes.json()).activity)[0];
			expect(utcDay.date).toBe(localDay(boundary, "UTC"));

			const athensRes = await app.request(
				`/analytics/me?organizationId=${ORG_ID}&projectId=${PROJECT_ID}&timezone=Europe/Athens`,
				{ headers: { Cookie: token } },
			);
			const athensDay = activeRows((await athensRes.json()).activity)[0];
			expect(athensDay.date).toBe(localDay(boundary, "Europe/Athens"));
			expect(athensDay.date).not.toBe(utcDay.date);
		});
	});
});
