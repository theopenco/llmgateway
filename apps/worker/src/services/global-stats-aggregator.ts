import { isStopRequested } from "@/shutdown.js";

import {
	db,
	log,
	organization,
	globalModelStats,
	globalProviderKeyModelStats,
	globalSourceStats,
	globalAggregationState,
	sql,
	and,
	eq,
	getTableColumns,
	isNotNull,
	type GlobalStatsOrgKind,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import {
	formatUTCTimestamp,
	getBaseAggregationFields,
	providerMarginAmountField,
} from "./project-stats-aggregator.js";

export const GLOBAL_STATS_INTERVAL_SECONDS =
	Number(process.env.GLOBAL_STATS_INTERVAL_SECONDS) || 3600;

// Hours that have closed within this many minutes are still considered
// "in flight" — we wait this long after an hour ends before processing it,
// so log inserts that landed slightly after their createdAt aren't missed
// by the incremental path.
const SETTLING_BUFFER_MINUTES =
	Number(process.env.GLOBAL_STATS_SETTLING_BUFFER_MINUTES) || 5;

// On first run (no watermark yet), how far back to seed.
const INITIAL_LOOKBACK_DAYS =
	Number(process.env.GLOBAL_STATS_INITIAL_LOOKBACK_DAYS) || 30;

// Cap per tick so a large catch-up doesn't tie up the worker.
const MAX_BUCKETS_PER_TICK =
	Number(process.env.GLOBAL_STATS_MAX_BUCKETS_PER_TICK) || 100;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Bucket size for the incremental walker. Defaults to 1 hour for production,
// but can be shrunk in dev (e.g. 60s) to see test data flow through within
// seconds. Must evenly divide one day so buckets align to day boundaries.
//
// WARNING: changing this on a running deployment will corrupt aggregates
// because the watermark math assumes a fixed bucket size. Reset by deleting
// the global_aggregation_state row and the affected day's stats rows.
const BUCKET_SECONDS = Number(process.env.GLOBAL_STATS_BUCKET_SECONDS) || 3600;
const BUCKET_MS = BUCKET_SECONDS * 1000;

if (DAY_MS % BUCKET_MS !== 0) {
	throw new Error(
		`GLOBAL_STATS_BUCKET_SECONDS=${BUCKET_SECONDS} must evenly divide 86400 (one day in seconds)`,
	);
}

type AggregationScope = "global" | "provider-key";

const STATE_ROW_IDS = {
	global: "singleton",
	"provider-key": "provider-key-model",
} as const;

// Columns the aggregator sums into the daily totals. Excludes id / createdAt
// / updatedAt / dimension columns.
const AGGREGATE_KEYS = [
	"requestCount",
	"errorCount",
	"cacheCount",
	"streamedCount",
	"nonStreamedCount",
	"completedCount",
	"lengthLimitCount",
	"contentFilterCount",
	"toolCallsCount",
	"canceledCount",
	"unknownFinishCount",
	"clientErrorCount",
	"gatewayErrorCount",
	"upstreamErrorCount",
	"inputTokens",
	"outputTokens",
	"totalTokens",
	"reasoningTokens",
	"cachedTokens",
	"cacheWriteTokens",
	"cost",
	"inputCost",
	"outputCost",
	"requestCost",
	"dataStorageCost",
	"discountSavings",
	"imageInputCost",
	"imageOutputCost",
	"audioInputCost",
	"audioOutputCost",
	"videoOutputCost",
	"cachedInputCost",
	"cacheWriteInputCost",
] as const;

type AnyTable = Parameters<typeof getTableColumns>[0];

// Drizzle's `casing: "snake_case"` applies at SQL emission time. The Column
// metadata (`col.name`) still holds the JS-side camelCase identifier when no
// explicit name was passed. We mirror drizzle's casing by converting here.
function toSnakeCase(s: string): string {
	return s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

// Build the SET clause for an ADD-style upsert: each metric column becomes
// `col = "table"."col" + excluded.col`, so each hour's aggregated values
// accumulate into the daily totals.
function buildAddUpsertSet(table: AnyTable, extraKeys: string[] = []) {
	const cols = getTableColumns(table) as Record<
		string,
		{ name: string } & object
	>;
	const set: Record<string, ReturnType<typeof sql>> = {};
	for (const key of [...AGGREGATE_KEYS, ...extraKeys]) {
		const col = cols[key];
		const snakeName = toSnakeCase(key);
		set[key] = sql`${col} + excluded.${sql.identifier(snakeName)}`;
	}
	return set;
}

// Only the model table carries the provider-keyed margin column.
const MODEL_ADD_SET = buildAddUpsertSet(globalModelStats, [
	"providerMarginAmount",
]);
const SOURCE_ADD_SET = buildAddUpsertSet(globalSourceStats);
const PROVIDER_KEY_MODEL_ADD_SET = buildAddUpsertSet(
	globalProviderKeyModelStats,
);

// Snap to the nearest bucket boundary at or below `d`. Works in UTC because
// JS timestamps are unix-epoch milliseconds and bucketMs evenly divides a day.
function floorToBucket(d: Date, bucketMs: number): Date {
	return new Date(Math.floor(d.getTime() / bucketMs) * bucketMs);
}

function floorToDay(d: Date): Date {
	return new Date(
		Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0),
	);
}

// Inferred drizzle transaction type so helpers can be called inside a tx.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Org kind for the request, falling back to "unknown" when the organization
// row is missing. The bare SQL is reused verbatim in GROUP BY because the
// aliased form is not addressable there.
const ORG_KIND_SQL = sql<GlobalStatsOrgKind>`coalesce(${organization.kind}, 'unknown')`;
const ORG_KIND_EXPR = ORG_KIND_SQL.as("orgKind");

export async function aggregateWindowIntoStats(
	database: Tx,
	windowStart: Date,
	windowMs: number,
): Promise<void> {
	const startTimestamp = formatUTCTimestamp(windowStart);
	const endTimestamp = formatUTCTimestamp(
		new Date(windowStart.getTime() + windowMs),
	);
	const dayTimestamp = formatUTCTimestamp(floorToDay(windowStart));

	const window = and(
		sql`${log.createdAt} >= ${startTimestamp}::timestamp`,
		sql`${log.createdAt} < ${endTimestamp}::timestamp`,
	);

	const modelRows = await database
		.select({
			usedModel: log.usedModel,
			usedProvider: log.usedProvider,
			usedMode: log.usedMode,
			orgKind: ORG_KIND_EXPR,
			...getBaseAggregationFields(),
			providerMarginAmount: providerMarginAmountField(),
		})
		.from(log)
		// LEFT, not INNER: log.organizationId has no foreign key, so an inner
		// join would silently drop requests whose organization row is gone
		// instead of bucketing them under "unknown".
		.leftJoin(organization, eq(log.organizationId, organization.id))
		.where(window)
		.groupBy(log.usedModel, log.usedProvider, log.usedMode, ORG_KIND_SQL);

	for (const row of modelRows) {
		const { usedModel, usedProvider, usedMode, orgKind, ...stats } = row;
		await database
			.insert(globalModelStats)
			.values({
				dayTimestamp: sql`${dayTimestamp}::timestamp`,
				usedModel,
				usedProvider,
				usedMode,
				orgKind,
				...stats,
			})
			.onConflictDoUpdate({
				target: [
					globalModelStats.dayTimestamp,
					globalModelStats.usedModel,
					globalModelStats.usedProvider,
					globalModelStats.usedMode,
					globalModelStats.orgKind,
				],
				set: {
					...MODEL_ADD_SET,
					updatedAt: new Date(),
				},
			});
	}

	const sourceRows = await database
		.select({
			source: sql<string>`coalesce(${log.source}, 'unknown')`.as("source"),
			usedMode: log.usedMode,
			orgKind: ORG_KIND_EXPR,
			...getBaseAggregationFields(),
		})
		.from(log)
		.leftJoin(organization, eq(log.organizationId, organization.id))
		.where(window)
		.groupBy(
			sql`coalesce(${log.source}, 'unknown')`,
			log.usedMode,
			ORG_KIND_SQL,
		);

	for (const row of sourceRows) {
		const { source, usedMode, orgKind, ...stats } = row;
		await database
			.insert(globalSourceStats)
			.values({
				dayTimestamp: sql`${dayTimestamp}::timestamp`,
				source,
				usedMode,
				orgKind,
				...stats,
			})
			.onConflictDoUpdate({
				target: [
					globalSourceStats.dayTimestamp,
					globalSourceStats.source,
					globalSourceStats.usedMode,
					globalSourceStats.orgKind,
				],
				set: {
					...SOURCE_ADD_SET,
					updatedAt: new Date(),
				},
			});
	}
}

export async function aggregateProviderKeyWindowIntoStats(
	database: Tx,
	windowStart: Date,
	windowMs: number,
): Promise<void> {
	const startTimestamp = formatUTCTimestamp(windowStart);
	const endTimestamp = formatUTCTimestamp(
		new Date(windowStart.getTime() + windowMs),
	);
	const dayTimestamp = formatUTCTimestamp(floorToDay(windowStart));
	const window = and(
		sql`${log.createdAt} >= ${startTimestamp}::timestamp`,
		sql`${log.createdAt} < ${endTimestamp}::timestamp`,
	);

	// Per-credential model split. Requests served by env-var credentials carry
	// no providerKeyId and are skipped, exactly like providerKeyHourlyStats.
	const providerKeyRows = await database
		.select({
			providerKeyId: sql<string>`${log.providerKeyId}`.as("providerKeyId"),
			usedModel: log.usedModel,
			usedProvider: log.usedProvider,
			usedMode: log.usedMode,
			orgKind: ORG_KIND_EXPR,
			...getBaseAggregationFields(),
		})
		.from(log)
		.leftJoin(organization, eq(log.organizationId, organization.id))
		.where(and(window, isNotNull(log.providerKeyId)))
		.groupBy(
			log.providerKeyId,
			log.usedModel,
			log.usedProvider,
			log.usedMode,
			ORG_KIND_SQL,
		);

	for (const row of providerKeyRows) {
		const {
			providerKeyId,
			usedModel,
			usedProvider,
			usedMode,
			orgKind,
			...stats
		} = row;
		await database
			.insert(globalProviderKeyModelStats)
			.values({
				dayTimestamp: sql`${dayTimestamp}::timestamp`,
				providerKeyId,
				usedModel,
				usedProvider,
				usedMode,
				orgKind,
				...stats,
			})
			.onConflictDoUpdate({
				target: [
					globalProviderKeyModelStats.dayTimestamp,
					globalProviderKeyModelStats.providerKeyId,
					globalProviderKeyModelStats.usedModel,
					globalProviderKeyModelStats.usedProvider,
					globalProviderKeyModelStats.usedMode,
					globalProviderKeyModelStats.orgKind,
				],
				set: {
					...PROVIDER_KEY_MODEL_ADD_SET,
					updatedAt: new Date(),
				},
			});
	}
}

async function readState(scope: AggregationScope) {
	return await db.query.globalAggregationState.findFirst({
		where: { id: STATE_ROW_IDS[scope] },
	});
}

async function setLastProcessedHour(
	database: Tx,
	hour: Date,
	scope: AggregationScope,
): Promise<void> {
	await database
		.insert(globalAggregationState)
		.values({ id: STATE_ROW_IDS[scope], lastProcessedHour: hour })
		.onConflictDoUpdate({
			target: globalAggregationState.id,
			set: { lastProcessedHour: hour, updatedAt: new Date() },
		});
}

async function setLastSafetyNetDay(
	database: Tx,
	day: Date,
	scope: AggregationScope,
): Promise<void> {
	await database
		.insert(globalAggregationState)
		.values({ id: STATE_ROW_IDS[scope], lastSafetyNetDay: day })
		.onConflictDoUpdate({
			target: globalAggregationState.id,
			set: { lastSafetyNetDay: day, updatedAt: new Date() },
		});
}

class AggregationStoppedError extends Error {}

// Keep replacement and its checkpoint atomic, including shutdown mid-day.
async function recomputeDayFully(
	tx: Tx,
	day: Date,
	scope: AggregationScope,
): Promise<void> {
	const dayStr = formatUTCTimestamp(day);
	if (scope === "global") {
		await tx
			.delete(globalModelStats)
			.where(sql`${globalModelStats.dayTimestamp} = ${dayStr}::timestamp`);
		await tx
			.delete(globalSourceStats)
			.where(sql`${globalSourceStats.dayTimestamp} = ${dayStr}::timestamp`);
	} else {
		await tx
			.delete(globalProviderKeyModelStats)
			.where(
				sql`${globalProviderKeyModelStats.dayTimestamp} = ${dayStr}::timestamp`,
			);
	}

	for (let h = 0; h < 24; h++) {
		if (isStopRequested()) {
			throw new AggregationStoppedError();
		}
		const hour = new Date(day.getTime() + h * HOUR_MS); // eslint-disable-line no-mixed-operators
		await AGGREGATORS[scope](tx, hour, HOUR_MS);
	}
}

async function runSafetyNetIfNeeded(
	now: Date,
	scope: AggregationScope,
): Promise<void> {
	const todayStart = floorToDay(now);
	const yesterdayStart = new Date(todayStart.getTime() - DAY_MS);
	const needsSafetyNet = (state: Awaited<ReturnType<typeof readState>>) =>
		state?.lastProcessedHour &&
		state.lastProcessedHour >= todayStart &&
		(!state.lastSafetyNetDay || state.lastSafetyNetDay < yesterdayStart);

	// Each scope must finish yesterday before its safety net can replace it.
	if (!needsSafetyNet(await readState(scope))) {
		return;
	}

	await db.transaction(async (tx) => {
		const [state] = await tx
			.select()
			.from(globalAggregationState)
			.where(eq(globalAggregationState.id, STATE_ROW_IDS[scope]))
			.for("update");
		if (!needsSafetyNet(state)) {
			return;
		}

		logger.info(
			`[global-${scope}-safety-net] Recomputing ${formatUTCTimestamp(yesterdayStart)} from logs`,
		);
		await recomputeDayFully(tx, yesterdayStart, scope);
		await setLastSafetyNetDay(tx, yesterdayStart, scope);
	});
}

const AGGREGATORS = {
	global: aggregateWindowIntoStats,
	"provider-key": aggregateProviderKeyWindowIntoStats,
};

async function processScopeClosedHours(
	now: Date,
	scope: AggregationScope,
): Promise<boolean> {
	const start = Date.now();
	const settlingMs = SETTLING_BUFFER_MINUTES * 60 * 1000;
	const cutoffMs = now.getTime() - BUCKET_MS - settlingMs;
	const latestSafeBucket = floorToBucket(new Date(cutoffMs), BUCKET_MS);

	const state = await readState(scope);

	let nextBucket: Date;
	if (state?.lastProcessedHour) {
		nextBucket = new Date(state.lastProcessedHour.getTime() + BUCKET_MS);
	} else if (scope === "provider-key") {
		// No existing rollup has the key/model dimensions together. Retention
		// clears log payloads but preserves attribution and metering columns.
		const [oldest] = await db
			.select({ createdAt: log.createdAt })
			.from(log)
			.where(isNotNull(log.providerKeyId))
			.orderBy(log.createdAt)
			.limit(1);
		if (!oldest) {
			return false;
		}
		nextBucket = floorToDay(oldest.createdAt);
		logger.info(
			`[global-provider-key] Backfilling from ${formatUTCTimestamp(nextBucket)}`,
		);
	} else {
		const lookbackMs = INITIAL_LOOKBACK_DAYS * DAY_MS;
		nextBucket = floorToBucket(new Date(now.getTime() - lookbackMs), BUCKET_MS);
		logger.info(
			`[global-${scope}] No watermark, seeding from ${formatUTCTimestamp(nextBucket)}`,
		);
	}

	let processed = 0;
	while (nextBucket <= latestSafeBucket && processed < MAX_BUCKETS_PER_TICK) {
		if (isStopRequested()) {
			logger.info(
				`[global-${scope}] Stop requested, processed ${processed} buckets`,
			);
			break;
		}

		const bucket = nextBucket;
		const lastProcessed = await db.transaction(async (tx) => {
			await tx
				.insert(globalAggregationState)
				.values({ id: STATE_ROW_IDS[scope] })
				.onConflictDoNothing();
			const [currentState] = await tx
				.select()
				.from(globalAggregationState)
				.where(eq(globalAggregationState.id, STATE_ROW_IDS[scope]))
				.for("update");
			// Serialize replicas before touching ADD-style aggregates.
			if (
				currentState.lastProcessedHour &&
				currentState.lastProcessedHour >= bucket
			) {
				return currentState.lastProcessedHour;
			}

			// The previous deployment may already have populated part of this
			// day. Clear it once before replaying; commit each hour with its cursor.
			if (
				scope === "provider-key" &&
				(!currentState.lastProcessedHour ||
					bucket.getTime() === floorToDay(bucket).getTime())
			) {
				const dayStr = formatUTCTimestamp(floorToDay(bucket));
				await tx
					.delete(globalProviderKeyModelStats)
					.where(
						sql`${globalProviderKeyModelStats.dayTimestamp} = ${dayStr}::timestamp`,
					);
			}
			await AGGREGATORS[scope](tx, bucket, BUCKET_MS);
			await setLastProcessedHour(tx, bucket, scope);
			return bucket;
		});

		processed++;
		nextBucket = new Date(lastProcessed.getTime() + BUCKET_MS);
	}

	if (processed >= MAX_BUCKETS_PER_TICK && nextBucket <= latestSafeBucket) {
		logger.info(
			`[global-${scope}] Hit per-tick cap (${MAX_BUCKETS_PER_TICK}), more buckets pending — will continue next tick`,
		);
	}

	if (processed > 0) {
		const lastProcessed = new Date(nextBucket.getTime() - BUCKET_MS);
		logger.info(
			`[global-${scope}] Processed ${processed} closed bucket(s) in ${Date.now() - start}ms (watermark now ${formatUTCTimestamp(lastProcessed)})`,
		);
	} else {
		logger.debug(`[global-${scope}] No new closed buckets to process`);
	}

	if (!isStopRequested()) {
		try {
			await runSafetyNetIfNeeded(now, scope);
		} catch (error) {
			if (error instanceof AggregationStoppedError) {
				return false;
			}
			logger.error(
				`[global-${scope}-safety-net] Failed`,
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}
	return nextBucket <= latestSafeBucket;
}

export async function processClosedHours(): Promise<boolean> {
	const now = new Date();
	const globalPending = await processScopeClosedHours(now, "global");
	if (!isStopRequested()) {
		const providerKeyPending = await processScopeClosedHours(
			now,
			"provider-key",
		);
		return globalPending || providerKeyPending;
	}
	return globalPending;
}
