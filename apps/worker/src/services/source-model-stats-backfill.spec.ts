import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { db, eq, tables } from "@llmgateway/db";

import { runSourceModelStatsBackfillStep } from "./source-model-stats-backfill.js";

vi.hoisted(() => {
	process.env.SOURCE_MODEL_STATS_BACKFILL_DAYS = "1";
});

const orgId = "source-model-backfill-org";
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
				eq(tables.globalAggregationState.id, "source-model-stats-backfill"),
			);
		await db.delete(tables.log).where(eq(tables.log.organizationId, orgId));
		await db
			.delete(tables.projectHourlySourceModelStats)
			.where(eq(tables.projectHourlySourceModelStats.projectId, projectId));
		await db
			.delete(tables.project)
			.where(eq(tables.project.organizationId, orgId));
		await db
			.delete(tables.organization)
			.where(eq(tables.organization.id, orgId));
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
});
