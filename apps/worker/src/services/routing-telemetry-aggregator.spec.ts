import { beforeEach, describe, expect, it } from "vitest";

import {
	apiKey,
	db,
	log,
	organization,
	project,
	routingElectionHourly,
	routingExclusionHourly,
	sql,
	user,
} from "@llmgateway/db";

import { calculateRoutingTelemetryForHour } from "./routing-telemetry-aggregator.js";

import type { InferInsertModel } from "@llmgateway/db";

const HOUR = new Date("2026-08-07T10:00:00.000Z");
const WITHIN_HOUR = new Date("2026-08-07T10:15:00.000Z");

type LogInsert = InferInsertModel<typeof log>;
type RoutingMetadata = NonNullable<LogInsert["routingMetadata"]>;

let logCounter = 0;

function logRow(overrides: Partial<LogInsert> = {}): LogInsert {
	logCounter += 1;
	return {
		id: `rt-log-${logCounter}`,
		requestId: `rt-req-${logCounter}`,
		organizationId: "rt-org",
		projectId: "rt-proj",
		apiKeyId: "rt-key",
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

function withMetadata(
	metadata: RoutingMetadata,
	overrides: Partial<LogInsert> = {},
): LogInsert {
	return logRow({ routingMetadata: metadata, ...overrides });
}

async function elections() {
	return (await db.select().from(routingElectionHourly)).map((row) => ({
		providerId: row.providerId,
		selectionReason: row.selectionReason,
		requestCount: row.requestCount,
		candidateCount: row.candidateCount,
		explicit: row.serviceTierExplicitCount,
		implicit: row.serviceTierImplicitCount,
	}));
}

async function exclusions() {
	return (await db.select().from(routingExclusionHourly)).map((row) => ({
		providerId: row.providerId,
		reason: row.reason,
		excludedCount: row.excludedCount,
		candidateCount: row.candidateCount,
		excludedDecisionCount: row.excludedDecisionCount,
	}));
}

describe("routing telemetry aggregator", () => {
	beforeEach(async () => {
		await db.delete(routingElectionHourly);
		await db.delete(routingExclusionHourly);
		await db.delete(log);
		await db.delete(apiKey);
		await db.delete(project);
		await db.delete(organization);
		await db.delete(user);

		const [testUser] = await db
			.insert(user)
			.values({ email: "routing-telemetry@example.com", name: "RT" })
			.returning();
		if (!testUser) {
			throw new Error("failed to seed the routing telemetry test user");
		}
		await db.insert(organization).values({
			id: "rt-org",
			name: "RT Org",
			billingEmail: testUser.email,
		});
		await db
			.insert(project)
			.values({ id: "rt-proj", name: "RT Project", organizationId: "rt-org" });
		await db.insert(apiKey).values({
			id: "rt-key",
			description: "RT key",
			tokenHash: "rt-token",
			tokenMasked: "rt-token",
			projectId: "rt-proj",
			createdBy: testUser.id,
		});
	});

	it("splits requests by selection reason and sums the candidate set size", async () => {
		await db.insert(log).values([
			withMetadata({
				selectionReason: "weighted-score",
				availableProviders: ["openai", "azure", "aws-mantle"],
			}),
			withMetadata({
				selectionReason: "weighted-score",
				availableProviders: ["openai", "azure"],
			}),
			withMetadata({
				selectionReason: "direct-provider-specified",
				availableProviders: ["openai"],
			}),
		]);

		await calculateRoutingTelemetryForHour(HOUR);

		expect(await elections()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					selectionReason: "weighted-score",
					requestCount: 2,
					candidateCount: 5,
				}),
				expect.objectContaining({
					selectionReason: "direct-provider-specified",
					requestCount: 1,
					candidateCount: 1,
				}),
			]),
		);
	});

	it("separates an implicitly applied tier from an explicitly requested one", async () => {
		await db.insert(log).values([
			// Coding-plan default: the gateway asked for flex, the client never did.
			// Only serviceTierSource separates this from an explicit request.
			withMetadata(
				{
					selectionReason: "single-provider-available",
					serviceTierSource: "coding-plan-default",
				},
				{ requestedServiceTier: "flex" },
			),
			withMetadata(
				{
					selectionReason: "single-provider-available",
					serviceTierSource: "request",
				},
				{ requestedServiceTier: "priority" },
			),
			// Pre-serviceTierSource row: a tier with no source counts as explicit.
			withMetadata(
				{ selectionReason: "single-provider-available" },
				{ requestedServiceTier: "flex" },
			),
			withMetadata({ selectionReason: "single-provider-available" }),
		]);

		await calculateRoutingTelemetryForHour(HOUR);

		expect(await elections()).toEqual([
			expect.objectContaining({ requestCount: 4, explicit: 2, implicit: 1 }),
		]);
	});

	it("folds an unrecognized selection reason into unknown", async () => {
		await db
			.insert(log)
			.values([withMetadata({ selectionReason: "reason-from-the-future" })]);

		await calculateRoutingTelemetryForHour(HOUR);

		expect(await elections()).toEqual([
			expect.objectContaining({ selectionReason: "unknown" }),
		]);
	});

	it("counts exclusion codes against the candidate set they were dropped from", async () => {
		await db.insert(log).values([
			withMetadata({
				selectionReason: "single-provider-available",
				availableProviders: ["openai"],
				filteredProviders: [
					{
						providerId: "azure",
						reasons: ["service tier not supported by this mapping"],
						codes: ["service_tier"],
					},
				],
			}),
			withMetadata({
				selectionReason: "single-provider-available",
				availableProviders: ["openai"],
				filteredProviders: [
					{
						providerId: "azure",
						reasons: ["service tier not supported by this mapping"],
						codes: ["service_tier"],
					},
				],
			}),
			withMetadata({
				selectionReason: "weighted-score",
				availableProviders: ["openai", "azure"],
			}),
		]);

		await calculateRoutingTelemetryForHour(HOUR);

		// Azure was a candidate in all three requests and excluded in two of them,
		// which is the exclusion rate the dashboard reports.
		expect(await exclusions()).toEqual([
			{
				providerId: "azure",
				reason: "service_tier",
				excludedCount: 2,
				candidateCount: 3,
				excludedDecisionCount: 2,
			},
		]);
	});

	it("counts a decision once when several reasons drop the same mapping", async () => {
		// Four decisions, azure a candidate in all of them, dropped in two — each
		// time for two reasons at once. Summing the reasons gives 4 and reads as
		// never eligible; the mapping served the other two requests.
		await db.insert(log).values([
			withMetadata({
				selectionReason: "single-provider-available",
				availableProviders: ["openai"],
				filteredProviders: [
					{
						providerId: "azure",
						reasons: ["service tier", "vision"],
						codes: ["service_tier", "vision"],
					},
				],
			}),
			withMetadata({
				selectionReason: "single-provider-available",
				availableProviders: ["openai"],
				filteredProviders: [
					{
						providerId: "azure",
						reasons: ["service tier", "vision"],
						codes: ["service_tier", "vision"],
					},
				],
			}),
			withMetadata({
				selectionReason: "weighted-score",
				availableProviders: ["openai", "azure"],
			}),
			withMetadata({
				selectionReason: "weighted-score",
				availableProviders: ["openai", "azure"],
			}),
		]);

		await calculateRoutingTelemetryForHour(HOUR);

		expect(await exclusions()).toEqual(
			expect.arrayContaining([
				{
					providerId: "azure",
					reason: "service_tier",
					excludedCount: 2,
					candidateCount: 4,
					excludedDecisionCount: 2,
				},
				{
					providerId: "azure",
					reason: "vision",
					excludedCount: 2,
					candidateCount: 4,
					excludedDecisionCount: 2,
				},
			]),
		);
	});

	it("gives a rate-limited mapping a denominator from its score entries", async () => {
		// A mapping dropped for rate limiting is annotated on providerScores and is
		// absent from availableProviders, so without that branch in the candidate
		// set it would have no denominator and report a flat 100% exclusion rate.
		await db.insert(log).values([
			withMetadata({
				selectionReason: "weighted-score",
				availableProviders: ["openai"],
				providerScores: [
					{ providerId: "openai", score: 1, price: 1 },
					{ providerId: "aws-mantle", score: 0, price: 1, rate_limited: true },
				],
			}),
			withMetadata({
				selectionReason: "weighted-score",
				availableProviders: ["openai", "aws-mantle"],
				providerScores: [
					{ providerId: "openai", score: 1, price: 1 },
					{ providerId: "aws-mantle", score: 0, price: 1 },
				],
			}),
		]);

		await calculateRoutingTelemetryForHour(HOUR);

		// Two decisions, rate-limited in one. The second decision lists aws-mantle
		// in both availableProviders and providerScores, and the candidate set is
		// deduplicated per decision so it still counts once.
		expect(await exclusions()).toEqual([
			{
				providerId: "aws-mantle",
				reason: "rate_limited",
				excludedCount: 1,
				candidateCount: 2,
				excludedDecisionCount: 1,
			},
		]);
	});

	it("counts a retry recovered on the same provider as one election", async () => {
		// The failed attempt and its retry are two log rows for one request. The
		// mapping and model rollups drop the failed row when the retry landed back
		// on the same provider and region; elections have to match, or the same
		// request is counted once there and twice here.
		await db.insert(log).values([
			withMetadata(
				{ selectionReason: "weighted-score", availableProviders: ["openai"] },
				{
					id: "rt-log-retry-final",
					hasError: false,
				},
			),
			withMetadata(
				{ selectionReason: "weighted-score", availableProviders: ["openai"] },
				{
					hasError: true,
					retried: true,
					retriedByLogId: "rt-log-retry-final",
				},
			),
		]);

		await calculateRoutingTelemetryForHour(HOUR);

		expect(await elections()).toEqual([
			expect.objectContaining({ requestCount: 1, candidateCount: 1 }),
		]);
	});

	it("maps content-filter and rate-limit metadata onto exclusion reasons", async () => {
		await db.insert(log).values([
			withMetadata({
				selectionReason: "weighted-score",
				availableProviders: ["openai"],
				filteredProviders: [
					{
						providerId: "azure",
						reasons: ["excluded by content-filter routing"],
						codes: ["content_filter"],
					},
				],
				contentFilterExcludedProviders: ["azure"],
				providerScores: [
					{ providerId: "aws-mantle", score: 0, price: 1, rate_limited: true },
				],
			}),
		]);

		await calculateRoutingTelemetryForHour(HOUR);

		expect(await exclusions()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					providerId: "azure",
					reason: "content_filter",
					excludedCount: 1,
				}),
				expect.objectContaining({
					providerId: "aws-mantle",
					reason: "rate_limited",
					excludedCount: 1,
				}),
			]),
		);
	});

	it("folds an unrecognized exclusion code into other", async () => {
		await db.insert(log).values([
			withMetadata({
				selectionReason: "weighted-score",
				availableProviders: ["openai"],
				filteredProviders: [
					{ providerId: "azure", reasons: ["?"], codes: ["not_a_real_code"] },
				],
			}),
		]);

		await calculateRoutingTelemetryForHour(HOUR);

		expect(await exclusions()).toEqual([
			expect.objectContaining({ reason: "other", excludedCount: 1 }),
		]);
	});

	it("ignores pre-codes rows without inventing a reason for them", async () => {
		// Rows written before exclusion codes existed carry only prose. They must
		// still count toward the candidate denominator, but contribute no reason.
		await db.insert(log).values([
			withMetadata({
				selectionReason: "weighted-score",
				availableProviders: ["openai"],
				filteredProviders: [
					{ providerId: "azure", reasons: ["vision not supported"] },
				],
			}),
		]);

		await calculateRoutingTelemetryForHour(HOUR);

		expect(await exclusions()).toEqual([]);
	});

	it("is idempotent, so a re-run of an hour does not double count", async () => {
		await db.insert(log).values([
			withMetadata({
				selectionReason: "weighted-score",
				availableProviders: ["openai"],
				filteredProviders: [
					{ providerId: "azure", reasons: ["vision"], codes: ["vision"] },
				],
			}),
		]);

		await calculateRoutingTelemetryForHour(HOUR);
		await calculateRoutingTelemetryForHour(HOUR);

		expect(await elections()).toEqual([
			expect.objectContaining({ requestCount: 1 }),
		]);
		expect(await exclusions()).toEqual([
			expect.objectContaining({ excludedCount: 1, candidateCount: 1 }),
		]);
	});

	it("leaves no election rows behind when the exclusion pass fails", async () => {
		// Presence in routing_election_hourly is what tells the backfill an hour is
		// done. If the elections committed on their own and the exclusions then
		// failed, the hour would look complete and never get its exclusion rows.
		await db.insert(log).values([
			withMetadata({
				selectionReason: "weighted-score",
				availableProviders: ["openai"],
				filteredProviders: [
					{ providerId: "azure", reasons: ["vision"], codes: ["vision"] },
				],
			}),
		]);

		// Break the exclusion query only, after the election upsert has run.
		await db.execute(
			sql`alter table "routing_exclusion_hourly" rename column "excluded_count" to "excluded_count_tmp"`,
		);
		try {
			await expect(calculateRoutingTelemetryForHour(HOUR)).rejects.toThrow();
		} finally {
			await db.execute(
				sql`alter table "routing_exclusion_hourly" rename column "excluded_count_tmp" to "excluded_count"`,
			);
		}

		expect(await elections()).toEqual([]);
	});

	it("only aggregates logs inside the target hour", async () => {
		await db
			.insert(log)
			.values([
				withMetadata({ selectionReason: "weighted-score" }),
				withMetadata(
					{ selectionReason: "weighted-score" },
					{ createdAt: new Date("2026-08-07T09:59:59.000Z") },
				),
				withMetadata(
					{ selectionReason: "weighted-score" },
					{ createdAt: new Date("2026-08-07T11:00:00.000Z") },
				),
			]);

		await calculateRoutingTelemetryForHour(HOUR);

		expect(await elections()).toEqual([
			expect.objectContaining({ requestCount: 1 }),
		]);
	});
});
