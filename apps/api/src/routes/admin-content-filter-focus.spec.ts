import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

const originalAdminEmails = process.env.ADMIN_EMAILS;

function hoursAgo(hours: number): Date {
	const date = new Date();
	date.setUTCMinutes(0, 0, 0);
	const offsetMs = hours * 3_600_000;
	date.setTime(date.getTime() - offsetMs);
	return date;
}

function modelRow(overrides: {
	organizationId: string;
	usedModel: string;
	usedProvider: string;
	sampledCount: number;
	violationCount: number;
	blockedCount?: number;
	hours?: number;
}) {
	return {
		hourTimestamp: hoursAgo(overrides.hours ?? 1),
		organizationId: overrides.organizationId,
		projectId: `proj-${overrides.organizationId}`,
		usedModel: overrides.usedModel,
		usedProvider: overrides.usedProvider,
		category: "all",
		sampledCount: overrides.sampledCount,
		violationCount: overrides.violationCount,
		blockedCount: overrides.blockedCount ?? 0,
	};
}

describe("admin content filter focus organizations", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();
		await db.insert(tables.organization).values([
			{ id: "cf-loud", name: "Loud Org", billingEmail: "loud@test.example" },
			{ id: "cf-big", name: "Big Org", billingEmail: "big@test.example" },
			{ id: "cf-tiny", name: "Tiny Org", billingEmail: "tiny@test.example" },
		]);
		await db.insert(tables.contentFilterHourlyModelStats).values([
			// 30% of a meaningful sample: the point of the drill-down.
			modelRow({
				organizationId: "cf-loud",
				usedModel: "openai/gpt-5.6-sol",
				usedProvider: "openai",
				sampledCount: 40,
				violationCount: 12,
				blockedCount: 4,
			}),
			// More violations overall, but a far lower rate.
			modelRow({
				organizationId: "cf-big",
				usedModel: "openai/gpt-5.6-sol",
				usedProvider: "openai",
				sampledCount: 100,
				violationCount: 15,
			}),
			// 100% of two requests: must not outrank the others.
			modelRow({
				organizationId: "cf-tiny",
				usedModel: "openai/gpt-5.6-sol",
				usedProvider: "openai",
				sampledCount: 2,
				violationCount: 2,
			}),
			// Same provider, different model: only counts at provider level.
			modelRow({
				organizationId: "cf-big",
				usedModel: "openai/gpt-5.6-terra",
				usedProvider: "openai",
				sampledCount: 60,
				violationCount: 30,
			}),
			// Another provider: never mixed in.
			modelRow({
				organizationId: "cf-loud",
				usedModel: "anthropic/claude-sonnet-5",
				usedProvider: "anthropic",
				sampledCount: 500,
				violationCount: 400,
			}),
			// Outside the 24h window.
			modelRow({
				organizationId: "cf-loud",
				usedModel: "openai/gpt-5.6-sol",
				usedProvider: "openai",
				sampledCount: 999,
				violationCount: 999,
				hours: 30,
			}),
		]);
	});

	afterEach(async () => {
		if (originalAdminEmails === undefined) {
			delete process.env.ADMIN_EMAILS;
		} else {
			process.env.ADMIN_EMAILS = originalAdminEmails;
		}
		await deleteAll();
	});

	test("ranks organizations by rate on one model", async () => {
		const res = await app.request(
			"/admin/content-filter/violations/organizations?window=24h&usedProvider=openai&usedModel=openai%2Fgpt-5.6-sol",
			{ headers: { Cookie: cookie } },
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.usedProvider).toBe("openai");
		expect(body.usedModel).toBe("openai/gpt-5.6-sol");
		expect(body.totals).toEqual({
			sampledCount: 142,
			violationCount: 29,
			blockedCount: 4,
			violationRate: 29 / 142,
		});
		expect(body.organizations).toEqual([
			{
				organizationId: "cf-loud",
				organizationName: "Loud Org",
				plan: "free",
				sampledCount: 40,
				violationCount: 12,
				blockedCount: 4,
				violationRate: 0.3,
				belowSampleFloor: false,
			},
			{
				organizationId: "cf-big",
				organizationName: "Big Org",
				plan: "free",
				sampledCount: 100,
				violationCount: 15,
				blockedCount: 0,
				violationRate: 0.15,
				belowSampleFloor: false,
			},
			// Below the floor, so it sorts last despite its 100% rate.
			{
				organizationId: "cf-tiny",
				organizationName: "Tiny Org",
				plan: "free",
				sampledCount: 2,
				violationCount: 2,
				blockedCount: 0,
				violationRate: 1,
				belowSampleFloor: true,
			},
		]);
	});

	test("summarizes the whole provider when no model is given", async () => {
		const res = await app.request(
			"/admin/content-filter/violations/organizations?window=24h&usedProvider=openai",
			{ headers: { Cookie: cookie } },
		);
		const body = await res.json();
		expect(body.usedModel).toBeNull();
		// Both OpenAI models roll into cf-big: 45 of 160.
		expect(
			body.organizations.map(
				(org: { organizationId: string }) => org.organizationId,
			),
		).toEqual(["cf-loud", "cf-big", "cf-tiny"]);
		expect(body.organizations[1]).toMatchObject({
			organizationId: "cf-big",
			sampledCount: 160,
			violationCount: 45,
		});
		expect(body.totals.sampledCount).toBe(202);
	});

	test("requires a provider", async () => {
		const res = await app.request(
			"/admin/content-filter/violations/organizations?window=24h",
			{ headers: { Cookie: cookie } },
		);
		expect(res.status).toBe(400);
	});

	test("requires authentication", async () => {
		const res = await app.request(
			"/admin/content-filter/violations/organizations?usedProvider=openai",
		);
		expect(res.status).toBe(401);
	});
});
