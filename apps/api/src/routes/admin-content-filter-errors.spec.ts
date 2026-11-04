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
	organizationId: string;
	kind: string;
	source?: string;
	status?: number;
	code?: string;
	errorCount: number;
	hours?: number;
	lastRequestId?: string;
}) {
	const hourTimestamp = hoursAgo(overrides.hours ?? 1);
	return {
		hourTimestamp,
		organizationId: overrides.organizationId,
		projectId: `proj-${overrides.organizationId}`,
		classifier: "internal",
		source: overrides.source ?? "openai",
		kind: overrides.kind,
		inputType: "image",
		status: overrides.status ?? 0,
		code: overrides.code ?? "",
		errorCount: overrides.errorCount,
		lastMessage: `${overrides.kind} message`,
		lastRequestId: overrides.lastRequestId ?? `req-${overrides.kind}`,
		lastSeenAt: new Date(hourTimestamp.getTime() + 600_000),
	};
}

describe("admin content filter errors", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "admin@example.com";
		cookie = await createTestUser();
		await db.insert(tables.organization).values([
			{ id: "cf-avif", name: "Avif Org", billingEmail: "avif@test.example" },
			{ id: "cf-slow", name: "Slow Org", billingEmail: "slow@test.example" },
		]);
		await db.insert(tables.contentFilterHourlyErrorStats).values([
			row({
				organizationId: "cf-avif",
				kind: "upstream_4xx",
				status: 400,
				code: "invalid_image_format",
				errorCount: 40,
				hours: 2,
				lastRequestId: "req-avif-old",
			}),
			row({
				organizationId: "cf-avif",
				kind: "upstream_4xx",
				status: 400,
				code: "invalid_image_format",
				errorCount: 10,
				hours: 1,
				lastRequestId: "req-avif-new",
			}),
			row({
				organizationId: "cf-slow",
				kind: "timeout",
				source: "internal",
				errorCount: 3,
			}),
			row({
				organizationId: "cf-slow",
				kind: "upstream_4xx",
				status: 400,
				code: "image_parse_error",
				errorCount: 1,
			}),
			// Outside the 24h window.
			row({
				organizationId: "cf-slow",
				kind: "upstream_5xx",
				status: 504,
				errorCount: 999,
				hours: 30,
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

	test("groups the window by kind, shape and organization", async () => {
		const res = await app.request("/admin/content-filter/errors?window=24h", {
			headers: { Cookie: cookie },
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.window).toBe("24h");
		expect(body.bucketTimestamps).toHaveLength(24);
		expect(body.totals).toEqual({
			errorCount: 54,
			byKind: [
				{ kind: "upstream_4xx", errorCount: 51 },
				{ kind: "timeout", errorCount: 3 },
			],
			bySource: [
				{ source: "openai", errorCount: 51 },
				{ source: "internal", errorCount: 3 },
			],
		});
		expect(
			body.buckets.map((b: { code: string; errorCount: number }) => [
				b.code,
				b.errorCount,
			]),
		).toEqual([
			["invalid_image_format", 50],
			["", 3],
			["image_parse_error", 1],
		]);
		expect(body.buckets[0].lastRequestId).toBe("req-avif-new");
		expect(body.organizations).toEqual([
			expect.objectContaining({
				organizationId: "cf-avif",
				organizationName: "Avif Org",
				errorCount: 50,
				topKind: "upstream_4xx",
				lastRequestId: "req-avif-new",
			}),
			expect.objectContaining({
				organizationId: "cf-slow",
				errorCount: 4,
				topKind: "timeout",
			}),
		]);
		expect(
			body.series.filter((p: { kind: string }) => p.kind === "upstream_4xx"),
		).toHaveLength(2);
	});

	test("filters by kind", async () => {
		const res = await app.request(
			"/admin/content-filter/errors?window=7d&kind=timeout",
			{ headers: { Cookie: cookie } },
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.kind).toBe("timeout");
		expect(body.totals.errorCount).toBe(3);
		expect(
			body.organizations.map(
				(o: { organizationId: string }) => o.organizationId,
			),
		).toEqual(["cf-slow"]);
	});

	test("rejects an unknown kind", async () => {
		const res = await app.request(
			"/admin/content-filter/errors?kind=whatever",
			{ headers: { Cookie: cookie } },
		);
		expect(res.status).toBe(400);
	});
});
