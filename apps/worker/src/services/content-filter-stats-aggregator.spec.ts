import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	apiKey,
	contentFilterHourlyStats,
	db,
	log,
	organization,
	project,
	user,
} from "@llmgateway/db";

import { calculateContentFilterStatsForHour } from "./content-filter-stats-aggregator.js";

import type {
	GatewayContentFilterEvaluation,
	InferInsertModel,
} from "@llmgateway/db";

const HOUR = new Date("2026-08-07T10:00:00.000Z");
const WITHIN_HOUR = new Date("2026-08-07T10:15:00.000Z");

type LogInsert = InferInsertModel<typeof log>;

let logCounter = 0;

function evaluation(
	overrides: Partial<GatewayContentFilterEvaluation> = {},
): GatewayContentFilterEvaluation {
	return {
		sampled: true,
		provider: "openai",
		tier: 0,
		overridden: false,
		level: "strict",
		violation: false,
		action: "passed",
		enforced: false,
		exemptReason: "global_log_only",
		flagged: false,
		matchedCategories: [],
		categoryScores: {},
		moderationFailed: false,
		...overrides,
	};
}

function logRow(overrides: Partial<LogInsert> = {}): LogInsert {
	logCounter += 1;
	return {
		id: `cf-log-${logCounter}`,
		requestId: `cf-req-${logCounter}`,
		organizationId: "cf-org",
		projectId: "cf-proj",
		apiKeyId: "cf-key",
		duration: 100,
		requestedModel: "gpt-5.6-sol",
		usedModel: "openai/gpt-5.6-sol",
		usedProvider: "openai",
		responseSize: 10,
		hasError: false,
		mode: "credits",
		usedMode: "credits",
		createdAt: WITHIN_HOUR,
		...overrides,
	};
}

async function statsRows() {
	return (await db.select().from(contentFilterHourlyStats))
		.map((row) => ({
			organizationId: row.organizationId,
			projectId: row.projectId,
			category: row.category,
			sampledCount: row.sampledCount,
			violationCount: row.violationCount,
			blockedCount: row.blockedCount,
		}))
		.sort((a, b) => a.category.localeCompare(b.category));
}

describe("content filter stats aggregator", () => {
	beforeEach(async () => {
		vi.setSystemTime(new Date("2026-08-08T00:00:00Z"));
		await db.delete(contentFilterHourlyStats);
		await db.delete(log);
		await db.delete(apiKey);
		await db.delete(project);
		await db.delete(organization);
		await db.delete(user);

		const [testUser] = await db
			.insert(user)
			.values({ email: "content-filter-stats@example.com", name: "CF" })
			.returning();
		if (!testUser) {
			throw new Error("failed to seed the content filter stats test user");
		}
		await db.insert(organization).values({
			id: "cf-org",
			name: "CF Org",
			billingEmail: testUser.email,
		});
		await db
			.insert(project)
			.values({ id: "cf-proj", name: "CF Project", organizationId: "cf-org" });
		await db.insert(apiKey).values({
			id: "cf-key",
			description: "CF key",
			tokenHash: "cf-token",
			tokenMasked: "cf-token",
			projectId: "cf-proj",
			createdBy: testUser.id,
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("rolls sampled evaluations up into totals and per-category rows", async () => {
		await db.insert(log).values([
			logRow({ gatewayContentFilterEvaluation: evaluation() }),
			logRow({
				gatewayContentFilterEvaluation: evaluation({
					violation: true,
					action: "logged",
					matchedCategories: ["violence", "harassment"],
				}),
			}),
			logRow({
				gatewayContentFilterEvaluation: evaluation({
					violation: true,
					action: "blocked",
					enforced: true,
					exemptReason: undefined,
					matchedCategories: ["violence"],
				}),
			}),
			// Not sampled: must not count at all.
			logRow(),
			// Outside the hour: ignored.
			logRow({
				gatewayContentFilterEvaluation: evaluation({ violation: true }),
				createdAt: new Date("2026-08-07T11:05:00.000Z"),
			}),
		]);

		expect(await calculateContentFilterStatsForHour(HOUR)).toEqual({
			rows: 3,
		});
		expect(await statsRows()).toEqual([
			{
				organizationId: "cf-org",
				projectId: "cf-proj",
				category: "all",
				sampledCount: 3,
				violationCount: 2,
				blockedCount: 1,
			},
			{
				organizationId: "cf-org",
				projectId: "cf-proj",
				category: "harassment",
				sampledCount: 0,
				violationCount: 1,
				blockedCount: 0,
			},
			{
				organizationId: "cf-org",
				projectId: "cf-proj",
				category: "violence",
				sampledCount: 0,
				violationCount: 2,
				blockedCount: 0,
			},
		]);
	});

	it("counts a retried request once", async () => {
		const retried = evaluation({
			violation: true,
			action: "logged",
			matchedCategories: ["violence"],
		});
		await db.insert(log).values([
			logRow({
				requestId: "cf-req-retried",
				hasError: true,
				gatewayContentFilterEvaluation: retried,
			}),
			logRow({
				requestId: "cf-req-retried",
				gatewayContentFilterEvaluation: retried,
			}),
		]);

		await calculateContentFilterStatsForHour(HOUR);
		expect(await statsRows()).toEqual([
			{
				organizationId: "cf-org",
				projectId: "cf-proj",
				category: "all",
				sampledCount: 1,
				violationCount: 1,
				blockedCount: 0,
			},
			{
				organizationId: "cf-org",
				projectId: "cf-proj",
				category: "violence",
				sampledCount: 0,
				violationCount: 1,
				blockedCount: 0,
			},
		]);
	});

	it("is idempotent across reruns", async () => {
		await db.insert(log).values([
			logRow({
				gatewayContentFilterEvaluation: evaluation({
					violation: true,
					action: "logged",
					matchedCategories: ["hate"],
				}),
			}),
		]);

		await calculateContentFilterStatsForHour(HOUR);
		await calculateContentFilterStatsForHour(HOUR);

		expect(await statsRows()).toEqual([
			{
				organizationId: "cf-org",
				projectId: "cf-proj",
				category: "all",
				sampledCount: 1,
				violationCount: 1,
				blockedCount: 0,
			},
			{
				organizationId: "cf-org",
				projectId: "cf-proj",
				category: "hate",
				sampledCount: 0,
				violationCount: 1,
				blockedCount: 0,
			},
		]);
	});

	it("skips hours past the retention cutoff", async () => {
		vi.setSystemTime(new Date("2026-09-07T10:00:00Z"));
		expect(await calculateContentFilterStatsForHour(HOUR)).toEqual({
			rows: 0,
		});
	});
});
