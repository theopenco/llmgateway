import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

const originalAdminEmails = process.env.ADMIN_FULL_ACCESS_EMAILS;

function hoursAgo(hours: number): Date {
	const date = new Date();
	date.setUTCMinutes(0, 0, 0);
	const offsetMs = hours * 3_600_000;
	date.setTime(date.getTime() - offsetMs);
	return date;
}

function row(overrides: {
	classifier: string;
	role: "deciding" | "shadow";
	category?: string;
	internalScope?: string;
	organizationId?: string;
	sampledCount?: number;
	violationCount: number;
	blockedCount?: number;
	durationSumMs?: number;
	durationCount?: number;
	hours?: number;
}) {
	return {
		hourTimestamp: hoursAgo(overrides.hours ?? 1),
		organizationId: overrides.organizationId ?? "org-a",
		projectId: "proj-a",
		category: overrides.category ?? "all",
		classifier: overrides.classifier,
		role: overrides.role,
		internalScope: overrides.internalScope ?? "",
		sampledCount: overrides.sampledCount ?? 0,
		violationCount: overrides.violationCount,
		blockedCount: overrides.blockedCount ?? 0,
		durationSumMs: overrides.durationSumMs ?? 0,
		durationCount: overrides.durationCount ?? 0,
	};
}

describe("admin content filter classifier comparison", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "admin@example.com";
		cookie = await createTestUser();
		await db.insert(tables.contentFilterHourlyStats).values([
			// Day one: OpenAI decides, the internal classifier shadows.
			row({
				classifier: "openai",
				role: "deciding",
				sampledCount: 100,
				violationCount: 4,
				blockedCount: 2,
				durationSumMs: 3000,
				durationCount: 100,
				hours: 30,
			}),
			row({
				classifier: "openai",
				role: "deciding",
				category: "violence",
				violationCount: 4,
				hours: 30,
			}),
			row({
				classifier: "internal",
				role: "shadow",
				internalScope: "full",
				sampledCount: 100,
				violationCount: 1,
				durationSumMs: 500,
				durationCount: 100,
				hours: 30,
			}),
			row({
				classifier: "internal",
				role: "shadow",
				internalScope: "full",
				category: "blocked",
				violationCount: 1,
				hours: 30,
			}),
			// Day two, swapped: the internal classifier decides for another org.
			row({
				classifier: "internal",
				role: "deciding",
				internalScope: "full",
				organizationId: "org-b",
				sampledCount: 100,
				violationCount: 3,
				blockedCount: 3,
				durationSumMs: 700,
				durationCount: 100,
				hours: 2,
			}),
			row({
				classifier: "openai",
				role: "shadow",
				organizationId: "org-b",
				sampledCount: 150,
				violationCount: 6,
				durationSumMs: 3000,
				durationCount: 150,
				hours: 2,
			}),
			// Outside the 7d window.
			row({
				classifier: "openai",
				role: "deciding",
				sampledCount: 999,
				violationCount: 999,
				hours: 24 * 8,
			}),
		]);
	});

	afterEach(async () => {
		if (originalAdminEmails === undefined) {
			delete process.env.ADMIN_FULL_ACCESS_EMAILS;
		} else {
			process.env.ADMIN_FULL_ACCESS_EMAILS = originalAdminEmails;
		}
		await deleteAll();
	});

	test("groups by classifier across roles and setups", async () => {
		const res = await app.request(
			"/admin/content-filter/classifiers?window=7d",
			{ headers: { Cookie: cookie } },
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.window).toBe("7d");
		expect(body.classifiers).toEqual([
			{
				classifier: "openai",
				internalScope: "",
				sampledCount: 250,
				violationCount: 10,
				blockedCount: 2,
				violationRate: 0.04,
				decidingSampledCount: 100,
				shadowSampledCount: 150,
				avgDurationMs: 24,
				organizationCount: 2,
			},
			{
				classifier: "internal",
				internalScope: "full",
				sampledCount: 200,
				violationCount: 4,
				blockedCount: 3,
				violationRate: 0.02,
				decidingSampledCount: 100,
				shadowSampledCount: 100,
				avgDurationMs: 6,
				organizationCount: 2,
			},
		]);
		expect(body.categories).toEqual([
			{
				classifier: "openai",
				internalScope: "",
				category: "violence",
				violationCount: 4,
			},
			{
				classifier: "internal",
				internalScope: "full",
				category: "blocked",
				violationCount: 1,
			},
		]);
		// One point per (day, classifier); quiet days are left to the client.
		expect(body.series).toHaveLength(4);
		expect(body.bucketTimestamps).toContain(body.series[0].bucket);
	});

	test("rejects non-admins", async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "someone-else@example.com";
		const res = await app.request("/admin/content-filter/classifiers", {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(403);
	});
});
