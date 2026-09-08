import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { requestStop, resetShutdown } from "@/shutdown.js";

import {
	db,
	eq,
	globalAggregationState,
	globalModelStats,
	globalProviderKeyModelStats,
	globalSourceStats,
	log,
	sql,
} from "@llmgateway/db";

import {
	aggregateProviderKeyWindowIntoStats,
	aggregateWindowIntoStats,
	processClosedHours,
} from "./global-stats-aggregator.js";

const HOUR_MS = 3_600_000;
const NOW = new Date("2026-06-15T12:10:00Z");
const TODAY = new Date("2026-06-15T00:00:00Z");
const YESTERDAY = new Date("2026-06-14T00:00:00Z");
const LATEST_HOUR = new Date("2026-06-15T11:00:00Z");

const insertLog = (
	createdAt: Date,
	providerKeyId: string | null = "backfill-key",
) =>
	db.insert(log).values({
		requestId: randomUUID(),
		createdAt,
		organizationId: "backfill-org",
		projectId: "backfill-project",
		apiKeyId: "backfill-api-key",
		providerKeyId,
		requestedModel: "backfill-model",
		usedModel: "backfill-model",
		usedProvider: "openai",
		mode: "credits",
		usedMode: "credits",
		cost: 0.25,
		promptTokens: "10",
		completionTokens: "20",
		totalTokens: "30",
		duration: 100,
		responseSize: 0,
		dataRetentionCleanedUp: true,
		messages: null,
		content: null,
	});

const readProviderStats = () =>
	db.query.globalProviderKeyModelStats.findMany({
		orderBy: { dayTimestamp: "asc" },
	});

const readProviderState = () =>
	db.query.globalAggregationState.findFirst({
		where: { id: "provider-key-model" },
	});

async function clearStats() {
	await db.delete(globalAggregationState);
	await db.delete(globalProviderKeyModelStats);
	await db.delete(globalModelStats);
	await db.delete(globalSourceStats);
	await db.delete(log);
}

describe("provider-key global stats backfill", () => {
	beforeEach(async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(NOW);
		resetShutdown();
		await clearStats();
		await db.insert(globalAggregationState).values({
			id: "singleton",
			lastProcessedHour: LATEST_HOUR,
			lastSafetyNetDay: YESTERDAY,
		});
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		vi.useRealTimers();
		resetShutdown();
		await clearStats();
	});

	test("backfills beyond the global lookback without changing existing totals", async () => {
		const oldHour = new Date("2026-05-01T08:00:00Z");
		await insertLog(oldHour);
		await db.transaction((tx) =>
			aggregateWindowIntoStats(tx, oldHour, HOUR_MS),
		);
		const globalBefore = await db.query.globalModelStats.findMany();
		const sourceBefore = await db.query.globalSourceStats.findMany();
		const stateBefore = await db.query.globalAggregationState.findFirst({
			where: { id: "singleton" },
		});

		expect(await processClosedHours()).toBe(true);

		const [row] = await readProviderStats();
		expect(row).toMatchObject({
			dayTimestamp: new Date("2026-05-01T00:00:00Z"),
			providerKeyId: "backfill-key",
			orgKind: "unknown",
			requestCount: 1,
			cost: 0.25,
			totalTokens: "30",
		});
		expect((await readProviderState())?.lastProcessedHour).toEqual(
			new Date("2026-05-05T03:00:00Z"),
		);
		expect(await db.query.globalModelStats.findMany()).toEqual(globalBefore);
		expect(await db.query.globalSourceStats.findMany()).toEqual(sourceBefore);
		expect(
			await db.query.globalAggregationState.findFirst({
				where: { id: "singleton" },
			}),
		).toEqual(stateBefore);

		await processClosedHours();
		expect((await readProviderState())?.lastProcessedHour).toEqual(
			new Date("2026-05-09T07:00:00Z"),
		);
		expect(await readProviderStats()).toEqual([row]);
	});

	test("replaces overlapping days and hands off to incremental aggregation", async () => {
		await insertLog(new Date("2026-06-13T23:30:00Z"));
		await insertLog(new Date("2026-06-14T00:30:00Z"));
		await insertLog(new Date("2026-06-14T12:30:00Z"));
		await insertLog(new Date("2026-06-15T00:30:00Z"));
		await insertLog(new Date("2026-06-15T11:30:00Z"));
		await insertLog(new Date("2026-06-15T11:45:00Z"), null);
		await insertLog(new Date("2026-06-15T12:01:00Z"));
		// Simulate the merged worker having populated only some recent hours.
		await db.transaction(async (tx) => {
			await aggregateProviderKeyWindowIntoStats(tx, YESTERDAY, HOUR_MS);
			await aggregateProviderKeyWindowIntoStats(tx, TODAY, HOUR_MS);
		});

		expect(await processClosedHours()).toBe(false);
		const rows = await readProviderStats();
		expect(rows.map((row) => row.requestCount)).toEqual([1, 2, 2]);
		expect(rows.map((row) => row.cost)).toEqual([0.25, 0.5, 0.5]);
		expect(rows.map((row) => row.totalTokens)).toEqual(["30", "60", "60"]);
		expect((await readProviderState())?.lastProcessedHour).toEqual(LATEST_HOUR);
		expect((await readProviderState())?.lastSafetyNetDay).toEqual(YESTERDAY);

		await processClosedHours();
		expect(await readProviderStats()).toEqual(rows);

		vi.setSystemTime(new Date("2026-06-15T13:04:00Z"));
		await processClosedHours();
		expect(await readProviderStats()).toEqual(rows);
		vi.setSystemTime(new Date("2026-06-15T13:05:00Z"));
		await processClosedHours();
		expect((await readProviderStats()).map((row) => row.requestCount)).toEqual([
			1, 2, 3,
		]);
	});

	test("resumes a committed partial day after shutdown without clearing it again", async () => {
		await insertLog(new Date("2026-06-15T00:30:00Z"));
		await insertLog(new Date("2026-06-15T01:30:00Z"));
		const transaction = db.transaction.bind(db);
		vi.spyOn(db, "transaction").mockImplementationOnce(async (callback) => {
			const result = await transaction(callback);
			requestStop();
			return result;
		});

		await processClosedHours();
		expect((await readProviderState())?.lastProcessedHour).toEqual(TODAY);
		expect((await readProviderStats())[0].requestCount).toBe(1);

		resetShutdown();
		await processClosedHours();
		expect((await readProviderStats())[0].requestCount).toBe(2);
		expect((await readProviderState())?.lastProcessedHour).toEqual(LATEST_HOUR);
	});

	test("rolls back the day reset and cursor together when a bucket fails", async () => {
		await insertLog(new Date("2026-06-15T00:30:00Z"));
		await db.transaction((tx) =>
			aggregateProviderKeyWindowIntoStats(tx, TODAY, HOUR_MS),
		);
		const rows = await readProviderStats();
		const transaction = db.transaction.bind(db);
		vi.spyOn(db, "transaction").mockImplementationOnce((callback) =>
			transaction(async (tx) => {
				await callback(tx);
				throw new Error("Backfill interrupted");
			}),
		);

		await expect(processClosedHours()).rejects.toThrow("Backfill interrupted");
		expect(await readProviderStats()).toEqual(rows);
		expect(await readProviderState()).toBeUndefined();

		await processClosedHours();
		expect((await readProviderStats())[0].requestCount).toBe(1);
		expect((await readProviderState())?.lastProcessedHour).toEqual(LATEST_HOUR);
	});

	test("runs the provider-key safety net independently of the global cursor", async () => {
		await insertLog(new Date("2026-06-14T12:30:00Z"));
		await processClosedHours();
		await insertLog(new Date("2026-06-14T13:30:00Z"));
		await db
			.update(globalAggregationState)
			.set({ lastSafetyNetDay: null })
			.where(eq(globalAggregationState.id, "provider-key-model"));

		await processClosedHours();
		expect((await readProviderStats())[0].requestCount).toBe(2);
		await processClosedHours();
		expect((await readProviderStats())[0].requestCount).toBe(2);
	});

	test("waits for attributed traffic and skips earlier unattributed history", async () => {
		await insertLog(new Date("2025-01-01T00:30:00Z"), null);
		expect(await processClosedHours()).toBe(false);
		expect((await readProviderState())?.lastProcessedHour).toBeNull();

		await insertLog(new Date("2026-06-15T00:30:00Z"));
		expect(await processClosedHours()).toBe(false);
		expect((await readProviderStats())[0].requestCount).toBe(1);
		expect((await readProviderState())?.lastProcessedHour).toEqual(LATEST_HOUR);
	});

	test("finds the oldest timestamp across keys, including removed credentials", async () => {
		// Key order differs from timestamp order; none needs a provider_key row.
		await insertLog(new Date("2026-06-15T00:30:00Z"), "a-key");
		await insertLog(new Date("2026-06-14T00:30:00Z"), "m-key");
		await insertLog(new Date("2026-06-13T00:30:00Z"), "z-removed-key");
		await insertLog(new Date("2026-06-15T01:30:00Z"), "z-removed-key");

		expect(await processClosedHours()).toBe(false);
		const rows = await readProviderStats();
		expect(rows[0]).toMatchObject({
			dayTimestamp: new Date("2026-06-13T00:00:00Z"),
			providerKeyId: "z-removed-key",
			requestCount: 1,
		});
		expect(rows.reduce((sum, row) => sum + row.requestCount, 0)).toBe(4);
		expect((await readProviderState())?.lastProcessedHour).toEqual(LATEST_HOUR);
	});

	test("serializes overlapping workers without double counting", async () => {
		await insertLog(new Date("2026-06-14T00:30:00Z"));
		await insertLog(new Date("2026-06-15T00:30:00Z"));

		await Promise.all([processClosedHours(), processClosedHours()]);

		expect((await readProviderStats()).map((row) => row.requestCount)).toEqual([
			1, 1,
		]);
		expect((await readProviderState())?.lastProcessedHour).toEqual(LATEST_HOUR);
		expect((await readProviderState())?.lastSafetyNetDay).toEqual(YESTERDAY);
	});

	test("restores the transaction timeout after locating the backfill start", async () => {
		await insertLog(new Date("2026-06-15T00:30:00Z"));
		const transaction = db.transaction.bind(db);
		vi.spyOn(db, "transaction").mockImplementationOnce((callback) =>
			transaction(async (tx) => {
				await tx.execute(sql`SET LOCAL statement_timeout = '7s'`);
				const result = await callback(tx);
				const timeout = await tx.execute<{ statement_timeout: string }>(
					sql`SHOW statement_timeout`,
				);
				expect(timeout.rows[0].statement_timeout).toBe("7s");
				return result;
			}),
		);

		await processClosedHours();
		expect((await readProviderStats())[0].requestCount).toBe(1);
	});

	test("preserves a complete day if the safety-net transaction fails", async () => {
		await insertLog(new Date("2026-06-14T00:30:00Z"));
		await processClosedHours();
		await insertLog(new Date("2026-06-14T01:30:00Z"));
		await db
			.update(globalAggregationState)
			.set({ lastSafetyNetDay: null })
			.where(eq(globalAggregationState.id, "provider-key-model"));
		const rows = await readProviderStats();
		const transaction = db.transaction.bind(db);
		vi.spyOn(db, "transaction").mockImplementationOnce((callback) =>
			transaction(async (tx) => {
				await callback(tx);
				throw new Error("Safety net interrupted");
			}),
		);

		await processClosedHours();
		expect(await readProviderStats()).toEqual(rows);
		expect((await readProviderState())?.lastSafetyNetDay).toBeNull();

		await processClosedHours();
		expect((await readProviderStats())[0].requestCount).toBe(2);
		expect((await readProviderState())?.lastSafetyNetDay).toEqual(YESTERDAY);
	});
});
