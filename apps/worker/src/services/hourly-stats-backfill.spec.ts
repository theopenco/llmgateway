import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { db, eq, inArray, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import {
	runModelStatsByokErrorsBackfillStep,
	runSourceModelStatsBackfillStep,
	runTenantStatsByokSplitBackfillStep,
} from "./hourly-stats-backfill.js";

vi.hoisted(() => {
	process.env.SOURCE_MODEL_STATS_BACKFILL_DAYS = "1";
	process.env.TENANT_STATS_BYOK_BACKFILL_DAYS = "1";
});

const orgId = "source-model-backfill-org";
const userId = "source-model-backfill-user";
const projectId = "source-model-backfill-project";
const now = new Date("2026-09-12T12:30:00Z");

function logValues(
	overrides: Partial<typeof tables.log.$inferInsert>,
): typeof tables.log.$inferInsert {
	return {
		requestId: randomUUID(),
		organizationId: orgId,
		projectId,
		apiKeyId: "source-model-backfill-key",
		createdAt: new Date("2026-09-12T09:15:00Z"),
		requestedModel: "claude-haiku-4-5",
		usedModel: "anthropic/claude-haiku-4-5",
		usedProvider: "anthropic",
		source: "opencode",
		duration: 100,
		responseSize: 100,
		mode: "credits",
		usedMode: "credits",
		totalTokens: "1500",
		cost: 0.001,
		...overrides,
	};
}

describe("source model stats backfill", () => {
	async function cleanup() {
		await db
			.delete(tables.globalAggregationState)
			.where(
				inArray(tables.globalAggregationState.id, [
					"source-model-stats-backfill",
					"model-stats-byok-errors-backfill",
					"tenant-stats-byok-split-backfill",
				]),
			);
		await db.delete(tables.log).where(eq(tables.log.organizationId, orgId));
		await db
			.delete(tables.projectHourlySourceModelStats)
			.where(eq(tables.projectHourlySourceModelStats.projectId, projectId));
		await db
			.delete(tables.projectHourlyModelStats)
			.where(eq(tables.projectHourlyModelStats.projectId, projectId));
		await db
			.delete(tables.projectHourlyStats)
			.where(eq(tables.projectHourlyStats.projectId, projectId));
		await db
			.delete(tables.apiKeyHourlyStats)
			.where(eq(tables.apiKeyHourlyStats.projectId, projectId));
		await db
			.delete(tables.apiKeyHourlyModelStats)
			.where(eq(tables.apiKeyHourlyModelStats.projectId, projectId));
		await db
			.delete(tables.apiKey)
			.where(eq(tables.apiKey.projectId, projectId));
		await db
			.delete(tables.project)
			.where(eq(tables.project.organizationId, orgId));
		await db
			.delete(tables.organization)
			.where(eq(tables.organization.id, orgId));
		await db.delete(tables.user).where(eq(tables.user.id, userId));
	}

	beforeEach(async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(now);
		await cleanup();
		await db.insert(tables.organization).values({
			id: orgId,
			name: "Test Organization",
			billingEmail: "source-model-backfill@example.com",
		});
		await db.insert(tables.project).values({
			id: projectId,
			name: "Test Project",
			organizationId: orgId,
		});
	});

	afterEach(async () => {
		vi.useRealTimers();
		await cleanup();
	});

	test("rolls up past hours up to the hour it first ran", async () => {
		await db.insert(tables.log).values([
			logValues({}),
			logValues({ createdAt: new Date("2026-09-12T09:45:00Z") }),
			logValues({ createdAt: new Date("2026-09-12T11:05:00Z"), source: null }),
			// Before the 1-day window and in the live hour: both left alone.
			logValues({ createdAt: new Date("2026-09-11T11:00:00Z") }),
			logValues({ createdAt: new Date("2026-09-12T12:10:00Z") }),
		]);

		for (let i = 0; i < 100 && (await runSourceModelStatsBackfillStep()); i++) {
			// Walks one hour per step.
		}

		const rows = await db.query.projectHourlySourceModelStats.findMany({
			where: { projectId },
			orderBy: { hourTimestamp: "asc" },
		});
		expect(
			rows.map((row) => ({
				hour: row.hourTimestamp.toISOString(),
				source: row.source,
				requestCount: row.requestCount,
			})),
		).toEqual([
			{ hour: "2026-09-12T09:00:00.000Z", source: "opencode", requestCount: 2 },
			{ hour: "2026-09-12T11:00:00.000Z", source: "unknown", requestCount: 1 },
		]);

		expect(await runSourceModelStatsBackfillStep()).toBe(false);
	});

	test("fills BYOK error counts of the last 3 days", async () => {
		const byokError = {
			usedMode: "api-keys",
			hasError: true,
			unifiedFinishReason: "upstream_error",
		} as const;
		await db.insert(tables.log).values([
			logValues({ ...byokError }),
			logValues({ ...byokError, unifiedFinishReason: "gateway_error" }),
			logValues({ ...byokError, usedMode: "credits" }),
			logValues({}),
			// Outside the 3-day window.
			logValues({ ...byokError, createdAt: new Date("2026-09-09T09:15:00Z") }),
		]);

		for (
			let i = 0;
			i < 100 && (await runModelStatsByokErrorsBackfillStep());
			i++
		) {
			// Walks one hour per step.
		}

		const rows = await db.query.projectHourlyModelStats.findMany({
			where: { projectId },
		});
		expect(
			rows.map((row) => ({
				hour: row.hourTimestamp.toISOString(),
				requestCount: row.requestCount,
				upstreamErrorCount: row.upstreamErrorCount,
				apiKeysUpstreamErrorCount: row.apiKeysUpstreamErrorCount,
				apiKeysGatewayErrorCount: row.apiKeysGatewayErrorCount,
			})),
		).toEqual([
			{
				hour: "2026-09-12T09:00:00.000Z",
				requestCount: 4,
				upstreamErrorCount: 2,
				apiKeysUpstreamErrorCount: 1,
				apiKeysGatewayErrorCount: 1,
			},
		]);
	});

	test("fills the BYOK error and latency split of the tenant stats", async () => {
		await db
			.insert(tables.user)
			.values({ id: userId, email: "source-model-backfill@example.com" });
		await db.insert(tables.apiKey).values({
			id: "source-model-backfill-key",
			...hashApiKeyForStorage("source-model-backfill-token"),
			projectId,
			description: "Test Key",
			createdBy: userId,
		});
		await db.insert(tables.log).values([
			logValues({
				usedMode: "api-keys",
				hasError: true,
				unifiedFinishReason: "client_error",
				duration: 300,
				timeToFirstToken: 120,
			}),
			logValues({
				usedMode: "api-keys",
				hasError: true,
				unifiedFinishReason: "upstream_error",
				duration: 500,
			}),
			logValues({ duration: 100, timeToFirstToken: 40 }),
		]);

		for (
			let i = 0;
			i < 100 && (await runTenantStatsByokSplitBackfillStep());
			i++
		) {
			// Walks one hour per step.
		}

		const split = (row: {
			requestCount: number;
			clientErrorCount: number;
			apiKeysClientErrorCount: number;
			apiKeysUpstreamErrorCount: number;
			totalDuration: number;
			apiKeysTotalDuration: number;
			apiKeysDurationCount: number;
			apiKeysTotalTimeToFirstToken: number;
			apiKeysTimeToFirstTokenCount: number;
		}) => ({
			requestCount: row.requestCount,
			clientErrorCount: row.clientErrorCount,
			apiKeysClientErrorCount: row.apiKeysClientErrorCount,
			apiKeysUpstreamErrorCount: row.apiKeysUpstreamErrorCount,
			totalDuration: row.totalDuration,
			apiKeysTotalDuration: row.apiKeysTotalDuration,
			apiKeysDurationCount: row.apiKeysDurationCount,
			apiKeysTotalTimeToFirstToken: row.apiKeysTotalTimeToFirstToken,
			apiKeysTimeToFirstTokenCount: row.apiKeysTimeToFirstTokenCount,
		});
		const expected = {
			requestCount: 3,
			clientErrorCount: 1,
			apiKeysClientErrorCount: 1,
			apiKeysUpstreamErrorCount: 1,
			totalDuration: 900,
			apiKeysTotalDuration: 800,
			apiKeysDurationCount: 2,
			apiKeysTotalTimeToFirstToken: 120,
			apiKeysTimeToFirstTokenCount: 1,
		};
		for (const rows of await Promise.all([
			db.query.projectHourlyStats.findMany({ where: { projectId } }),
			db.query.projectHourlyModelStats.findMany({ where: { projectId } }),
			db.query.apiKeyHourlyStats.findMany({ where: { projectId } }),
			db.query.apiKeyHourlyModelStats.findMany({ where: { projectId } }),
		])) {
			expect(rows.map(split)).toEqual([expected]);
		}
	});
});
