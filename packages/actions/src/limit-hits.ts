import { redisClient } from "@llmgateway/cache";
import { db, inArray, sql, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { limitHitsKey, spendUtcDateKey } from "@llmgateway/shared";

import type { OrgLimitType } from "@llmgateway/shared";

/**
 * Durable tracking of who is hitting the anti-abuse limits and how hard, for
 * the admin dashboard (and future outreach). Rejections are counted into a
 * per-UTC-day Redis hash on the hot path (one pipelined write, fail-open) and
 * flushed into `org_limit_hit_daily` by a worker loop with additive upserts,
 * so a hammering org costs no Postgres writes per rejection.
 */

const LIMIT_HITS_TTL_SECONDS = 3 * 24 * 60 * 60;

/** Chunk size for the flush upsert, same order as the stats aggregators. */
const FLUSH_CHUNK_SIZE = 500;

function field(
	metric: "c" | "u",
	organizationId: string,
	limitType: OrgLimitType,
	endpointKey: string,
) {
	return `${metric}|${organizationId}|${limitType}|${endpointKey}`;
}

/**
 * Count one rejected request/charge. Fail-open and cheap (single pipelined
 * Redis write) — safe to call from the gateway hot path.
 */
export async function recordLimitHit(options: {
	organizationId: string;
	limitType: OrgLimitType;
	/** PATH_RATE_LIMITS key for rpm hits; omit for the other families. */
	endpointKey?: string;
	/** Gross USD of a rejected top-up attempt. */
	blockedUsd?: number;
	now?: number;
}): Promise<void> {
	const {
		organizationId,
		limitType,
		endpointKey = "",
		blockedUsd = 0,
		now = Date.now(),
	} = options;
	try {
		const key = limitHitsKey(spendUtcDateKey(now));
		const pipeline = redisClient.pipeline();
		pipeline.hincrby(
			key,
			field("c", organizationId, limitType, endpointKey),
			1,
		);
		if (blockedUsd > 0) {
			pipeline.hincrbyfloat(
				key,
				field("u", organizationId, limitType, endpointKey),
				blockedUsd,
			);
		}
		pipeline.expire(key, LIMIT_HITS_TTL_SECONDS);
		await pipeline.exec();
	} catch (error) {
		// Tracking must never affect the request outcome.
		logger.error("Failed to record limit hit:", error as Error);
	}
}

interface FlushBucket {
	organizationId: string;
	limitType: OrgLimitType;
	endpointKey: string;
	hitCount: number;
	blockedUsd: string;
}

function parseHash(hash: Record<string, string>): FlushBucket[] {
	const buckets = new Map<string, FlushBucket>();
	for (const [fieldName, value] of Object.entries(hash)) {
		const [metric, organizationId, limitType, endpointKey = ""] =
			fieldName.split("|");
		if (!organizationId || !limitType || (metric !== "c" && metric !== "u")) {
			continue;
		}
		const bucketKey = `${organizationId}|${limitType}|${endpointKey}`;
		let bucket = buckets.get(bucketKey);
		if (!bucket) {
			bucket = {
				organizationId,
				limitType: limitType as OrgLimitType,
				endpointKey,
				hitCount: 0,
				blockedUsd: "0",
			};
			buckets.set(bucketKey, bucket);
		}
		if (metric === "c") {
			bucket.hitCount += Number(value) || 0;
		} else {
			// Keep USD as a string; the additive upsert sums in SQL numeric.
			bucket.blockedUsd = value;
		}
	}
	return [...buckets.values()].filter((b) => b.hitCount > 0);
}

async function upsertBuckets(dayKey: string, buckets: FlushBucket[]) {
	if (buckets.length === 0) {
		return 0;
	}
	// Orgs can be deleted between hit and flush; dropping their rows beats
	// failing the whole batch on the FK.
	const orgIds = [...new Set(buckets.map((b) => b.organizationId))];
	const existing = await db
		.select({ id: tables.organization.id })
		.from(tables.organization)
		.where(inArray(tables.organization.id, orgIds));
	const known = new Set(existing.map((o) => o.id));
	const rows = buckets
		.filter((b) => known.has(b.organizationId))
		.map((b) => ({
			organizationId: b.organizationId,
			day: new Date(`${dayKey}T00:00:00.000Z`),
			limitType: b.limitType,
			endpointKey: b.endpointKey,
			hitCount: b.hitCount,
			blockedUsd: b.blockedUsd,
		}));
	for (let i = 0; i < rows.length; i += FLUSH_CHUNK_SIZE) {
		const chunk = rows.slice(i, i + FLUSH_CHUNK_SIZE);
		await db
			.insert(tables.orgLimitHitDaily)
			.values(chunk)
			.onConflictDoUpdate({
				target: [
					tables.orgLimitHitDaily.organizationId,
					tables.orgLimitHitDaily.day,
					tables.orgLimitHitDaily.limitType,
					tables.orgLimitHitDaily.endpointKey,
				],
				set: {
					hitCount: sql`${tables.orgLimitHitDaily.hitCount} + excluded.hit_count`,
					blockedUsd: sql`${tables.orgLimitHitDaily.blockedUsd} + excluded.blocked_usd`,
					updatedAt: new Date(),
				},
			});
	}
	return rows.length;
}

/**
 * Drain one day's Redis hash into Postgres. The live hash is atomically
 * RENAMEd to a deterministic `:flushing` key first, so increments arriving
 * mid-flush start a fresh hash and are never lost; a `:flushing` key left by
 * a crashed run is drained before renaming again. Caller must hold the
 * flush lock (single flusher), which is what makes the RENAME safe.
 * A crash between upsert and DEL double-counts that batch once — acceptable
 * for abuse telemetry, preferred over losing it.
 */
export async function flushLimitHitsForDay(dayKey: string): Promise<number> {
	const key = limitHitsKey(dayKey);
	const flushingKey = `${key}:flushing`;
	let flushed = 0;
	for (const source of [flushingKey, key]) {
		if (!(await redisClient.exists(source))) {
			continue;
		}
		if (source === key) {
			try {
				await redisClient.rename(key, flushingKey);
			} catch {
				// Key expired/vanished between EXISTS and RENAME.
				continue;
			}
		}
		const hash = await redisClient.hgetall(flushingKey);
		flushed += await upsertBuckets(dayKey, parseHash(hash));
		await redisClient.del(flushingKey);
	}
	return flushed;
}

/**
 * Flush every buffer that can still exist (UTC), oldest first so a buffer
 * straddling midnight lands under the day its hits belong to. Covers the full
 * key TTL, not just yesterday+today: after worker downtime across two UTC
 * boundaries an older unexpired buffer would otherwise never drain.
 */
export async function flushLimitHits(
	now: number = Date.now(),
): Promise<number> {
	let flushed = 0;
	const daysCovered = Math.ceil(LIMIT_HITS_TTL_SECONDS / 86_400) + 1;
	for (let i = daysCovered - 1; i >= 0; i--) {
		const offsetMs = i * 86_400_000;
		flushed += await flushLimitHitsForDay(spendUtcDateKey(now - offsetMs));
	}
	return flushed;
}
