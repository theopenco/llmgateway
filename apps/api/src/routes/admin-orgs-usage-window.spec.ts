import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import {
	aggregateLogsForTesting,
	createTestUser,
	deleteAll,
} from "@/testing.js";

import { db, tables } from "@llmgateway/db";

const RECENT_ORG_ID = "usage-window-recent-org";
const RECENT_PROJECT_ID = "usage-window-recent-project";
const RECENT_KEY_ID = "usage-window-recent-key";
const OLD_ORG_ID = "usage-window-old-org";
const OLD_PROJECT_ID = "usage-window-old-project";
const OLD_KEY_ID = "usage-window-old-key";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number) {
	const offset = days * DAY_MS;
	return new Date(Date.now() - offset);
}

function toDay(date: Date) {
	return date.toISOString().split("T")[0];
}

function makeLog(o: {
	id: string;
	projectId: string;
	organizationId: string;
	apiKeyId: string;
	createdAt: Date;
	cost: number;
	totalTokens: string;
}) {
	return {
		id: o.id,
		requestId: o.id,
		createdAt: o.createdAt,
		updatedAt: o.createdAt,
		organizationId: o.organizationId,
		projectId: o.projectId,
		apiKeyId: o.apiKeyId,
		duration: 100,
		requestedModel: "gpt-4",
		requestedProvider: "openai",
		usedModel: "gpt-4",
		usedProvider: "openai",
		responseSize: 100,
		promptTokens: "10",
		completionTokens: "10",
		totalTokens: o.totalTokens,
		messages: JSON.stringify([{ role: "user", content: "hi" }]),
		mode: "hybrid" as const,
		usedMode: "credits" as const,
		cost: o.cost,
	};
}

interface OrgListResponse {
	organizations: {
		id: string;
		totalSpent?: string;
		totalRequests?: number;
		totalTokens?: number;
	}[];
}

describe("admin — organizations list usage window", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();

		await db.insert(tables.organization).values([
			{
				id: RECENT_ORG_ID,
				name: "Usage Window Recent Org",
				billingEmail: "usage-window-recent@example.com",
			},
			{
				id: OLD_ORG_ID,
				name: "Usage Window Old Org",
				billingEmail: "usage-window-old@example.com",
			},
		]);

		await db.insert(tables.project).values([
			{
				id: RECENT_PROJECT_ID,
				name: "Usage Window Recent Project",
				organizationId: RECENT_ORG_ID,
			},
			{
				id: OLD_PROJECT_ID,
				name: "Usage Window Old Project",
				organizationId: OLD_ORG_ID,
			},
		]);

		await db.insert(tables.apiKey).values([
			{
				id: RECENT_KEY_ID,
				token: "usage-window-recent-token",
				projectId: RECENT_PROJECT_ID,
				description: "Recent Key",
				createdBy: "test-user-id",
			},
			{
				id: OLD_KEY_ID,
				token: "usage-window-old-token",
				projectId: OLD_PROJECT_ID,
				description: "Old Key",
				createdBy: "test-user-id",
			},
		]);

		await db.insert(tables.log).values([
			// Recent org: 2 requests, 300 tokens, $3 — inside a 90-day window.
			makeLog({
				id: "usage-window-recent-1",
				projectId: RECENT_PROJECT_ID,
				organizationId: RECENT_ORG_ID,
				apiKeyId: RECENT_KEY_ID,
				createdAt: daysAgo(2),
				cost: 1,
				totalTokens: "100",
			}),
			makeLog({
				id: "usage-window-recent-2",
				projectId: RECENT_PROJECT_ID,
				organizationId: RECENT_ORG_ID,
				apiKeyId: RECENT_KEY_ID,
				createdAt: daysAgo(3),
				cost: 2,
				totalTokens: "200",
			}),
			// Old org: 1 request, 9000 tokens, $50 — outside a 90-day window, so it
			// only shows up for all time.
			makeLog({
				id: "usage-window-old-1",
				projectId: OLD_PROJECT_ID,
				organizationId: OLD_ORG_ID,
				apiKeyId: OLD_KEY_ID,
				createdAt: daysAgo(200),
				cost: 50,
				totalTokens: "9000",
			}),
		]);

		await aggregateLogsForTesting();
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("returns all-time request and token totals when no window is given", async () => {
		const res = await app.request("/admin/organizations?limit=50", {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as OrgListResponse;

		const recent = body.organizations.find((o) => o.id === RECENT_ORG_ID);
		expect(recent).toBeDefined();
		expect(recent!.totalRequests).toBe(2);
		expect(recent!.totalTokens).toBe(300);
		expect(parseFloat(recent!.totalSpent ?? "0")).toBeCloseTo(3, 3);

		const old = body.organizations.find((o) => o.id === OLD_ORG_ID);
		expect(old).toBeDefined();
		expect(old!.totalRequests).toBe(1);
		expect(old!.totalTokens).toBe(9000);
		expect(parseFloat(old!.totalSpent ?? "0")).toBeCloseTo(50, 3);
	});

	test("scopes spend, requests, and tokens to the from/to window", async () => {
		const res = await app.request(
			`/admin/organizations?limit=50&from=${toDay(daysAgo(89))}&to=${toDay(daysAgo(0))}`,
			{ headers: { Cookie: cookie } },
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as OrgListResponse;

		const recent = body.organizations.find((o) => o.id === RECENT_ORG_ID);
		expect(recent!.totalRequests).toBe(2);
		expect(recent!.totalTokens).toBe(300);
		expect(parseFloat(recent!.totalSpent ?? "0")).toBeCloseTo(3, 3);

		// The org is still listed — only its usage aggregates fall to zero.
		const old = body.organizations.find((o) => o.id === OLD_ORG_ID);
		expect(old).toBeDefined();
		expect(old!.totalRequests).toBe(0);
		expect(old!.totalTokens).toBe(0);
		expect(parseFloat(old!.totalSpent ?? "0")).toBeCloseTo(0, 3);
	});

	test("sorts by request count and token count", async () => {
		const byRequests = (await (
			await app.request(
				"/admin/organizations?limit=50&sortBy=totalRequests&sortOrder=desc",
				{ headers: { Cookie: cookie } },
			)
		).json()) as OrgListResponse;
		expect(byRequests.organizations[0]?.id).toBe(RECENT_ORG_ID);

		const byTokens = (await (
			await app.request(
				"/admin/organizations?limit=50&sortBy=totalTokens&sortOrder=desc",
				{ headers: { Cookie: cookie } },
			)
		).json()) as OrgListResponse;
		expect(byTokens.organizations[0]?.id).toBe(OLD_ORG_ID);

		// Within the recent window the old org has no tokens, so the ordering flips.
		const byTokensWindowed = (await (
			await app.request(
				`/admin/organizations?limit=50&sortBy=totalTokens&sortOrder=desc&from=${toDay(daysAgo(89))}&to=${toDay(daysAgo(0))}`,
				{ headers: { Cookie: cookie } },
			)
		).json()) as OrgListResponse;
		expect(byTokensWindowed.organizations[0]?.id).toBe(RECENT_ORG_ID);
	});

	test("rejects a malformed from/to window", async () => {
		const res = await app.request(
			"/admin/organizations?limit=50&from=not-a-date&to=2026-01-01",
			{ headers: { Cookie: cookie } },
		);
		expect(res.status).toBe(400);
	});

	// `Date.parse` would roll these over to a real day rather than reject them.
	test.each(["2026-02-30", "2026-04-31", "2026-1-1"])(
		"rejects the impossible date %s",
		async (day) => {
			const res = await app.request(
				`/admin/organizations?limit=50&from=${day}&to=2026-12-01`,
				{ headers: { Cookie: cookie } },
			);
			expect(res.status).toBe(400);
		},
	);

	test("rejects a half-open window instead of silently widening it", async () => {
		const fromOnly = await app.request(
			"/admin/organizations?limit=50&from=2026-01-01",
			{ headers: { Cookie: cookie } },
		);
		expect(fromOnly.status).toBe(400);

		const toOnly = await app.request(
			"/admin/organizations?limit=50&to=2026-01-31",
			{ headers: { Cookie: cookie } },
		);
		expect(toOnly.status).toBe(400);
	});

	test("still treats an entirely absent window as all time", async () => {
		const res = await app.request("/admin/organizations?limit=50", {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as OrgListResponse;
		const old = body.organizations.find((o) => o.id === OLD_ORG_ID);
		expect(old!.totalRequests).toBe(1);
	});
});
