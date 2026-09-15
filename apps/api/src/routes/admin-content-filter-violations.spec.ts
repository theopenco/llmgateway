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

describe("admin content filter violations", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();
		await db.insert(tables.organization).values([
			{ id: "cf-org-a", name: "Org A", billingEmail: "a@test.example" },
			{ id: "cf-org-b", name: "Org B", billingEmail: "b@test.example" },
		]);
		await db.insert(tables.contentFilterHourlyStats).values([
			{
				hourTimestamp: hoursAgo(1),
				organizationId: "cf-org-a",
				projectId: "proj-a",
				category: "all",
				sampledCount: 10,
				violationCount: 4,
				blockedCount: 1,
			},
			{
				hourTimestamp: hoursAgo(1),
				organizationId: "cf-org-a",
				projectId: "proj-a",
				category: "violence",
				sampledCount: 0,
				violationCount: 3,
				blockedCount: 0,
			},
			{
				hourTimestamp: hoursAgo(1),
				organizationId: "cf-org-a",
				projectId: "proj-a",
				category: "hate",
				sampledCount: 0,
				violationCount: 1,
				blockedCount: 0,
			},
			{
				hourTimestamp: hoursAgo(2),
				organizationId: "cf-org-b",
				projectId: "proj-b",
				category: "all",
				sampledCount: 20,
				violationCount: 1,
				blockedCount: 0,
			},
			// Outside the 24h window.
			{
				hourTimestamp: hoursAgo(30),
				organizationId: "cf-org-b",
				projectId: "proj-b",
				category: "all",
				sampledCount: 100,
				violationCount: 50,
				blockedCount: 0,
			},
		]);
		await db.insert(tables.contentFilterHourlyModelStats).values([
			{
				hourTimestamp: hoursAgo(1),
				organizationId: "cf-org-a",
				projectId: "proj-a",
				usedModel: "openai/gpt-5.6-sol",
				usedProvider: "openai",
				category: "all",
				sampledCount: 6,
				violationCount: 3,
				blockedCount: 1,
			},
			{
				hourTimestamp: hoursAgo(1),
				organizationId: "cf-org-a",
				projectId: "proj-a",
				usedModel: "anthropic/claude-sonnet-5",
				usedProvider: "anthropic",
				category: "all",
				sampledCount: 4,
				violationCount: 1,
				blockedCount: 0,
			},
			{
				hourTimestamp: hoursAgo(2),
				organizationId: "cf-org-b",
				projectId: "proj-b",
				usedModel: "openai/gpt-5.6-sol",
				usedProvider: "openai",
				category: "all",
				sampledCount: 20,
				violationCount: 1,
				blockedCount: 0,
			},
			// Outside the 24h window.
			{
				hourTimestamp: hoursAgo(30),
				organizationId: "cf-org-b",
				projectId: "proj-b",
				usedModel: "openai/gpt-5.6-sol",
				usedProvider: "openai",
				category: "all",
				sampledCount: 100,
				violationCount: 50,
				blockedCount: 0,
			},
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

	test("ranks organizations by violations within the window", async () => {
		const res = await app.request(
			"/admin/content-filter/violations?window=24h",
			{ headers: { Cookie: cookie } },
		);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			window: "24h",
			sort: "violations",
			minSampled: 0,
			totals: { sampledCount: 30, violationCount: 5, blockedCount: 1 },
			organizations: [
				{
					organizationId: "cf-org-a",
					organizationName: "Org A",
					billingEmail: "a@test.example",
					plan: "free",
					sampledCount: 10,
					violationCount: 4,
					blockedCount: 1,
					violationRate: 0.4,
					topCategories: [
						{ category: "violence", violationCount: 3 },
						{ category: "hate", violationCount: 1 },
					],
					topModels: [
						{
							usedModel: "openai/gpt-5.6-sol",
							usedProvider: "openai",
							sampledCount: 6,
							violationCount: 3,
							blockedCount: 1,
							violationRate: 0.5,
						},
						{
							usedModel: "anthropic/claude-sonnet-5",
							usedProvider: "anthropic",
							sampledCount: 4,
							violationCount: 1,
							blockedCount: 0,
							violationRate: 0.25,
						},
					],
					topProviders: [
						{
							usedProvider: "openai",
							sampledCount: 6,
							violationCount: 3,
							blockedCount: 1,
							violationRate: 0.5,
						},
						{
							usedProvider: "anthropic",
							sampledCount: 4,
							violationCount: 1,
							blockedCount: 0,
							violationRate: 0.25,
						},
					],
				},
				{
					organizationId: "cf-org-b",
					organizationName: "Org B",
					billingEmail: "b@test.example",
					plan: "free",
					sampledCount: 20,
					violationCount: 1,
					blockedCount: 0,
					violationRate: 0.05,
					topCategories: [],
					topModels: [
						{
							usedModel: "openai/gpt-5.6-sol",
							usedProvider: "openai",
							sampledCount: 20,
							violationCount: 1,
							blockedCount: 0,
							violationRate: 0.05,
						},
					],
					topProviders: [
						{
							usedProvider: "openai",
							sampledCount: 20,
							violationCount: 1,
							blockedCount: 0,
							violationRate: 0.05,
						},
					],
				},
			],
			models: [
				{
					usedModel: "openai/gpt-5.6-sol",
					usedProvider: "openai",
					sampledCount: 26,
					violationCount: 4,
					blockedCount: 1,
					violationRate: 4 / 26,
				},
				{
					usedModel: "anthropic/claude-sonnet-5",
					usedProvider: "anthropic",
					sampledCount: 4,
					violationCount: 1,
					blockedCount: 0,
					violationRate: 0.25,
				},
			],
			providers: [
				{
					usedProvider: "openai",
					sampledCount: 26,
					violationCount: 4,
					blockedCount: 1,
					violationRate: 4 / 26,
				},
				{
					usedProvider: "anthropic",
					sampledCount: 4,
					violationCount: 1,
					blockedCount: 0,
					violationRate: 0.25,
				},
			],
		});
	});

	test("ranks models by rate above the same sample floor", async () => {
		const res = await app.request(
			"/admin/content-filter/violations?window=24h&sort=rate&minSampled=10",
			{ headers: { Cookie: cookie } },
		);
		const body = await res.json();
		// The 4-sample Anthropic row is below the floor; only the pooled OpenAI
		// row survives, at the cross-tenant rate rather than either org's.
		expect(body.models).toEqual([
			{
				usedModel: "openai/gpt-5.6-sol",
				usedProvider: "openai",
				sampledCount: 26,
				violationCount: 4,
				blockedCount: 1,
				violationRate: 4 / 26,
			},
		]);
		expect(body.providers).toEqual([
			{
				usedProvider: "openai",
				sampledCount: 26,
				violationCount: 4,
				blockedCount: 1,
				violationRate: 4 / 26,
			},
		]);
	});

	test("rolls an organization's models up to their providers", async () => {
		// A second OpenAI model for org A: its provider row is the sum of both,
		// and is not capped by the per-model list.
		await db.insert(tables.contentFilterHourlyModelStats).values({
			hourTimestamp: hoursAgo(1),
			organizationId: "cf-org-a",
			projectId: "proj-a",
			usedModel: "openai/gpt-5.6-terra",
			usedProvider: "openai",
			category: "all",
			sampledCount: 10,
			violationCount: 2,
			blockedCount: 1,
		});

		const res = await app.request(
			"/admin/content-filter/violations?window=24h",
			{ headers: { Cookie: cookie } },
		);
		const body = await res.json();
		const orgA = body.organizations.find(
			(org: { organizationId: string }) => org.organizationId === "cf-org-a",
		);
		expect(orgA.topProviders).toEqual([
			{
				usedProvider: "openai",
				sampledCount: 16,
				violationCount: 5,
				blockedCount: 2,
				violationRate: 5 / 16,
			},
			{
				usedProvider: "anthropic",
				sampledCount: 4,
				violationCount: 1,
				blockedCount: 0,
				violationRate: 0.25,
			},
		]);
	});

	test("ranks by violation rate above a sample floor", async () => {
		await db.insert(tables.organization).values({
			id: "cf-org-c",
			name: "Org C",
			billingEmail: "c@test.example",
		});
		// One flagged request out of one: 100% but far too little data to rank.
		await db.insert(tables.contentFilterHourlyStats).values({
			hourTimestamp: hoursAgo(1),
			organizationId: "cf-org-c",
			projectId: "proj-c",
			category: "all",
			sampledCount: 1,
			violationCount: 1,
			blockedCount: 0,
		});

		const unfloored = await app.request(
			"/admin/content-filter/violations?window=24h&sort=rate",
			{ headers: { Cookie: cookie } },
		);
		expect(unfloored.status).toBe(200);
		const unflooredBody = await unfloored.json();
		expect(unflooredBody.sort).toBe("rate");
		expect(unflooredBody.minSampled).toBe(0);
		expect(
			unflooredBody.organizations.map(
				(org: { organizationId: string }) => org.organizationId,
			),
		).toEqual(["cf-org-c", "cf-org-a", "cf-org-b"]);

		const floored = await app.request(
			"/admin/content-filter/violations?window=24h&sort=rate&minSampled=10",
			{ headers: { Cookie: cookie } },
		);
		const flooredBody = await floored.json();
		expect(flooredBody.minSampled).toBe(10);
		expect(
			flooredBody.organizations.map(
				(org: { organizationId: string }) => org.organizationId,
			),
		).toEqual(["cf-org-a", "cf-org-b"]);
		// Totals stay window-wide regardless of the floor.
		expect(flooredBody.totals.sampledCount).toBe(31);
	});

	test("widens with the window", async () => {
		const res = await app.request(
			"/admin/content-filter/violations?window=7d",
			{ headers: { Cookie: cookie } },
		);
		const body = await res.json();
		expect(body.totals.violationCount).toBe(55);
		expect(body.organizations[0].organizationId).toBe("cf-org-b");
	});

	test("requires authentication", async () => {
		const res = await app.request("/admin/content-filter/violations");
		expect(res.status).toBe(401);
	});
});
