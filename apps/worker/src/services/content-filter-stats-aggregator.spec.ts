import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	apiKey,
	contentFilterHourlyModelStats,
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

async function modelStatsRows() {
	return (await db.select().from(contentFilterHourlyModelStats))
		.map((row) => ({
			usedModel: row.usedModel,
			usedProvider: row.usedProvider,
			category: row.category,
			sampledCount: row.sampledCount,
			violationCount: row.violationCount,
			blockedCount: row.blockedCount,
		}))
		.sort(
			(a, b) =>
				a.usedModel.localeCompare(b.usedModel) ||
				a.category.localeCompare(b.category),
		);
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

async function verdictRows(table: "org" | "model") {
	const rows =
		table === "org"
			? (await db.select().from(contentFilterHourlyStats)).map((row) => ({
					...row,
					usedModel: null,
				}))
			: await db.select().from(contentFilterHourlyModelStats);
	return rows
		.map((row) => ({
			usedModel: row.usedModel,
			category: row.category,
			classifier: row.classifier,
			role: row.role,
			sampledCount: row.sampledCount,
			violationCount: row.violationCount,
			blockedCount: row.blockedCount,
			durationSumMs: row.durationSumMs,
			durationCount: row.durationCount,
			durationMaxMs: row.durationMaxMs,
		}))
		.sort(
			(a, b) =>
				(a.usedModel ?? "").localeCompare(b.usedModel ?? "") ||
				a.role.localeCompare(b.role) ||
				a.classifier.localeCompare(b.classifier) ||
				a.category.localeCompare(b.category),
		);
}

const NO_DURATION = { durationSumMs: 0, durationCount: 0, durationMaxMs: null };

describe("content filter stats aggregator", () => {
	beforeEach(async () => {
		vi.setSystemTime(new Date("2026-08-08T00:00:00Z"));
		await db.delete(contentFilterHourlyModelStats);
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

	it("keeps partial violations inside the sampled cohort", async () => {
		await db.insert(log).values([
			logRow({ gatewayContentFilterEvaluation: evaluation() }),
			...[1, 2].map(() =>
				logRow({
					gatewayContentFilterEvaluation: evaluation({
						violation: true,
						moderationFailed: true,
						action: "blocked",
						matchedCategories: ["violence"],
					}),
				}),
			),
		]);
		await calculateContentFilterStatsForHour(HOUR);
		for (const rows of [await statsRows(), await modelStatsRows()]) {
			expect(rows.find((row) => row.category === "all")).toMatchObject({
				sampledCount: 3,
				violationCount: 2,
				blockedCount: 2,
			});
			expect(
				rows.find((row) => row.category === "violence")?.violationCount,
			).toBe(2);
		}
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
			// Moderation failed: nothing was scored, so not sampled.
			logRow({
				gatewayContentFilterEvaluation: evaluation({ moderationFailed: true }),
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
			modelRows: 3,
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

	it("breaks the rollup down by the model that served the request", async () => {
		await db.insert(log).values([
			logRow({
				gatewayContentFilterEvaluation: evaluation({
					violation: true,
					action: "blocked",
					matchedCategories: ["violence"],
				}),
			}),
			logRow({ gatewayContentFilterEvaluation: evaluation() }),
			logRow({
				usedModel: "anthropic/claude-sonnet-5",
				usedProvider: "anthropic",
				gatewayContentFilterEvaluation: evaluation({
					violation: true,
					action: "logged",
					matchedCategories: ["hate"],
				}),
			}),
		]);

		await calculateContentFilterStatsForHour(HOUR);
		expect(await modelStatsRows()).toEqual([
			{
				usedModel: "anthropic/claude-sonnet-5",
				usedProvider: "anthropic",
				category: "all",
				sampledCount: 1,
				violationCount: 1,
				blockedCount: 0,
			},
			{
				usedModel: "anthropic/claude-sonnet-5",
				usedProvider: "anthropic",
				category: "hate",
				sampledCount: 0,
				violationCount: 1,
				blockedCount: 0,
			},
			{
				usedModel: "openai/gpt-5.6-sol",
				usedProvider: "openai",
				category: "all",
				sampledCount: 2,
				violationCount: 1,
				blockedCount: 1,
			},
			{
				usedModel: "openai/gpt-5.6-sol",
				usedProvider: "openai",
				category: "violence",
				sampledCount: 0,
				violationCount: 1,
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

	it("keys rows by classifier, treating evaluations without one as openai", async () => {
		await db.insert(log).values([
			// Predates the classifier selector and duration capture.
			logRow({
				gatewayContentFilterEvaluation: evaluation({
					violation: true,
					action: "logged",
					matchedCategories: ["hate"],
				}),
			}),
			logRow({
				gatewayContentFilterEvaluation: evaluation({
					classifier: "internal",
					durationMs: 40,
				}),
			}),
		]);

		await calculateContentFilterStatsForHour(HOUR);
		expect(await verdictRows("org")).toEqual([
			{
				usedModel: null,
				category: "all",
				classifier: "internal",
				role: "deciding",
				sampledCount: 1,
				violationCount: 0,
				blockedCount: 0,
				durationSumMs: 40,
				durationCount: 1,
				durationMaxMs: 40,
			},
			{
				usedModel: null,
				category: "all",
				classifier: "openai",
				role: "deciding",
				sampledCount: 1,
				violationCount: 1,
				blockedCount: 0,
				...NO_DURATION,
			},
			{
				usedModel: null,
				category: "hate",
				classifier: "openai",
				role: "deciding",
				sampledCount: 0,
				violationCount: 1,
				blockedCount: 0,
				...NO_DURATION,
			},
		]);
	});

	it("rolls the shadow verdict up without ever counting it as blocked", async () => {
		const shadow = {
			classifier: "internal" as const,
			violation: true,
			flagged: true,
			matchedCategories: ["violence"],
			categoryScores: { violence: 0.9 },
			moderationFailed: false,
			disagreed: false,
			durationMs: 30,
		};
		await db.insert(log).values([
			logRow({
				gatewayContentFilterEvaluation: evaluation({
					classifier: "openai",
					violation: true,
					action: "blocked",
					enforced: true,
					exemptReason: undefined,
					matchedCategories: ["violence"],
					durationMs: 200,
					shadow,
				}),
			}),
			logRow({
				gatewayContentFilterEvaluation: evaluation({
					classifier: "openai",
					durationMs: 100,
					shadow: {
						...shadow,
						violation: false,
						flagged: false,
						matchedCategories: [],
						disagreed: false,
						durationMs: 10,
					},
				}),
			}),
			// The shadow check failed: not sampled, but its latency still counts.
			logRow({
				gatewayContentFilterEvaluation: evaluation({
					classifier: "openai",
					durationMs: 150,
					shadow: {
						...shadow,
						violation: false,
						flagged: false,
						matchedCategories: [],
						categoryScores: {},
						moderationFailed: true,
						disagreed: false,
						durationMs: 5000,
					},
				}),
			}),
		]);

		await calculateContentFilterStatsForHour(HOUR);
		const deciding = {
			usedModel: null,
			category: "all",
			classifier: "openai",
			role: "deciding",
			sampledCount: 3,
			violationCount: 1,
			blockedCount: 1,
			durationSumMs: 450,
			durationCount: 3,
			durationMaxMs: 200,
		};
		const shadowAll = {
			usedModel: null,
			category: "all",
			classifier: "internal",
			role: "shadow",
			sampledCount: 2,
			violationCount: 1,
			blockedCount: 0,
			durationSumMs: 5040,
			durationCount: 3,
			durationMaxMs: 5000,
		};
		expect(await verdictRows("org")).toEqual([
			deciding,
			{
				...deciding,
				category: "violence",
				sampledCount: 0,
				blockedCount: 0,
				...NO_DURATION,
			},
			shadowAll,
			{
				...shadowAll,
				category: "violence",
				sampledCount: 0,
				...NO_DURATION,
			},
		]);
		expect(
			(await verdictRows("model")).filter((row) => row.category === "all"),
		).toEqual([
			{ ...deciding, usedModel: "openai/gpt-5.6-sol" },
			{ ...shadowAll, usedModel: "openai/gpt-5.6-sol" },
		]);
	});

	it("sums each request's duration once, and once per model it touched", async () => {
		const retried = evaluation({ classifier: "internal", durationMs: 300 });
		await db.insert(log).values([
			logRow({
				gatewayContentFilterEvaluation: evaluation({
					classifier: "internal",
					durationMs: 100,
				}),
			}),
			logRow({
				requestId: "cf-req-retried",
				hasError: true,
				gatewayContentFilterEvaluation: retried,
			}),
			logRow({
				requestId: "cf-req-retried",
				hasError: true,
				gatewayContentFilterEvaluation: retried,
			}),
			logRow({
				requestId: "cf-req-retried",
				usedModel: "anthropic/claude-sonnet-5",
				usedProvider: "anthropic",
				gatewayContentFilterEvaluation: retried,
			}),
		]);

		await calculateContentFilterStatsForHour(HOUR);
		const durations = (rows: Awaited<ReturnType<typeof verdictRows>>) =>
			rows.map((row) => ({
				usedModel: row.usedModel,
				sampledCount: row.sampledCount,
				durationSumMs: row.durationSumMs,
				durationCount: row.durationCount,
				durationMaxMs: row.durationMaxMs,
			}));
		expect(durations(await verdictRows("org"))).toEqual([
			{
				usedModel: null,
				sampledCount: 2,
				durationSumMs: 400,
				durationCount: 2,
				durationMaxMs: 300,
			},
		]);
		expect(durations(await verdictRows("model"))).toEqual([
			{
				usedModel: "anthropic/claude-sonnet-5",
				sampledCount: 1,
				durationSumMs: 300,
				durationCount: 1,
				durationMaxMs: 300,
			},
			{
				usedModel: "openai/gpt-5.6-sol",
				sampledCount: 2,
				durationSumMs: 400,
				durationCount: 2,
				durationMaxMs: 300,
			},
		]);
	});

	it("replaces a row the pre-classifier rollup left for the hour", async () => {
		// Written before the classifier column existed, so it took the default.
		await db.insert(contentFilterHourlyStats).values({
			hourTimestamp: HOUR,
			organizationId: "cf-org",
			projectId: "cf-proj",
			category: "all",
			sampledCount: 1,
			violationCount: 0,
			blockedCount: 0,
		});
		await db.insert(log).values(
			logRow({
				gatewayContentFilterEvaluation: evaluation({ classifier: "internal" }),
			}),
		);

		await calculateContentFilterStatsForHour(HOUR);
		expect(await verdictRows("org")).toEqual([
			{
				usedModel: null,
				category: "all",
				classifier: "internal",
				role: "deciding",
				sampledCount: 1,
				violationCount: 0,
				blockedCount: 0,
				...NO_DURATION,
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

		expect(await modelStatsRows()).toHaveLength(2);
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
			modelRows: 0,
		});
	});
});
