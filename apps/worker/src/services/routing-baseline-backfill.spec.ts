import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { calculateCosts } from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";

import { runRoutingBaselineBackfillStep } from "./routing-baseline-backfill.js";

vi.hoisted(() => {
	process.env.ROUTING_BASELINE_BACKFILL_DAYS = "1";
});

const orgId = "routing-backfill-org";
const projectId = "routing-backfill-project";
const now = new Date("2026-09-12T12:30:00Z");

function logValues(
	overrides: Partial<typeof tables.log.$inferInsert>,
): typeof tables.log.$inferInsert {
	return {
		requestId: randomUUID(),
		organizationId: orgId,
		projectId,
		apiKeyId: "routing-backfill-key",
		createdAt: new Date("2026-09-12T09:15:00Z"),
		requestedModel: "auto",
		usedModel: "anthropic/claude-haiku-4-5",
		usedProvider: "anthropic",
		duration: 100,
		responseSize: 100,
		mode: "credits",
		usedMode: "credits",
		promptTokens: "1000",
		completionTokens: "500",
		totalTokens: "1500",
		cost: 0.001,
		...overrides,
	};
}

async function priced(modelId: string) {
	const costs = await calculateCosts(
		modelId,
		"anthropic",
		null,
		1000,
		500,
		null,
		undefined,
		null,
		0,
		undefined,
		0,
		null,
		orgId,
	);
	return costs.totalCost!;
}

async function runToCompletion() {
	for (let i = 0; i < 100 && (await runRoutingBaselineBackfillStep()); i++) {
		// Walks one hour per step.
	}
}

describe("routing baseline backfill", () => {
	async function cleanup() {
		await db
			.delete(tables.globalAggregationState)
			.where(eq(tables.globalAggregationState.id, "routing-baseline-backfill"));
		await db.delete(tables.log).where(eq(tables.log.organizationId, orgId));
		await db
			.delete(tables.projectHourlyRoutingStats)
			.where(eq(tables.projectHourlyRoutingStats.projectId, projectId));
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
			billingEmail: "routing-backfill@example.com",
		});
		await db.insert(tables.project).values({
			id: projectId,
			name: "Test Project",
			organizationId: orgId,
		});
		const [route] = await db
			.insert(tables.dynamicRoute)
			.values({ projectId, name: "support" })
			.returning();
		await db.insert(tables.dynamicRouteVersion).values({
			routeId: route.id,
			version: 1,
			graph: {
				entry: "split",
				nodes: [
					{
						id: "split",
						type: "percentage",
						splits: [
							{ weight: 1, next: "cheap" },
							{ weight: 1, next: "premium" },
						],
					},
					{ id: "cheap", type: "model", model: "claude-haiku-4-5" },
					{ id: "premium", type: "model", model: "claude-opus-4-6" },
				],
			},
		});
	});

	afterEach(async () => {
		vi.useRealTimers();
		await cleanup();
	});

	test("prices routed logs of the window and rolls them up per route", async () => {
		await db.insert(tables.log).values([
			logValues({ id: "rb-auto" }),
			logValues({
				id: "rb-smart",
				requestedModel: "smart",
				routingMetadata: {
					smartRouting: {
						classifier: "none",
						eligibleModels: ["claude-haiku-4-5", "claude-sonnet-4-6"],
						candidateModels: ["claude-haiku-4-5", "claude-sonnet-4-6"],
						selectedModel: "claude-haiku-4-5",
						classifierFailed: false,
					},
				},
			}),
			logValues({
				id: "rb-dynamic",
				requestedModel: "dynamic/support",
				routingMetadata: {
					dynamicRoute: { name: "support", version: 1, path: ["split"] },
				},
			}),
			logValues({ id: "rb-deleted-route", requestedModel: "dynamic/gone" }),
			logValues({ id: "rb-cached", cached: true }),
			logValues({ id: "rb-direct", requestedModel: "claude-haiku-4-5" }),
			logValues({
				id: "rb-outside-window",
				createdAt: new Date("2026-09-11T09:15:00Z"),
			}),
		]);

		await runToCompletion();

		const logs = new Map(
			(await db.query.log.findMany({ where: { organizationId: orgId } })).map(
				(row) => [row.id, row],
			),
		);
		const opus = await priced("claude-opus-4-6");
		expect(logs.get("rb-auto")).toMatchObject({
			routingBaselineModel: "anthropic/claude-opus-4-6",
			routingBaselineCost: expect.closeTo(opus, 8),
		});
		expect(logs.get("rb-smart")).toMatchObject({
			routingBaselineModel: "anthropic/claude-sonnet-4-6",
			routingBaselineCost: expect.closeTo(await priced("claude-sonnet-4-6"), 8),
		});
		expect(logs.get("rb-dynamic")).toMatchObject({
			routingBaselineModel: "anthropic/claude-opus-4-6",
		});
		for (const id of [
			"rb-deleted-route",
			"rb-cached",
			"rb-direct",
			"rb-outside-window",
		]) {
			expect(logs.get(id)?.routingBaselineCost).toBeNull();
		}

		const stats = await db.query.projectHourlyRoutingStats.findMany({
			where: { projectId },
		});
		expect(stats.map((row) => [row.routeKey, row.requestCount]).sort()).toEqual(
			[
				["auto", 1],
				["dynamic/support", 1],
				["smart", 1],
			],
		);
		const auto = stats.find((row) => row.routeKey === "auto");
		expect(auto?.cost).toBeCloseTo(0.001);
		expect(auto?.baselineCost).toBeCloseTo(opus, 6);

		// Finished: further steps do nothing.
		expect(await runRoutingBaselineBackfillStep()).toBe(false);
	});
});
