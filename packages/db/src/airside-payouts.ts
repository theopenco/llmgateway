/**
 * Airside payout statement helpers, shared by the worker (monthly refresh)
 * and the API (admin backfill, carrier report).
 */
import { and, eq, sql, type AnyColumn } from "drizzle-orm";

import { db } from "./db.js";
import { globalModelStats, type providerClaim } from "./schema.js";

type Claim = Pick<
	typeof providerClaim.$inferSelect,
	"status" | "createdAt" | "reviewedAt" | "revokedAt"
>;

/**
 * Whether a payout claim was live during [start, end): an active claim
 * approved before the period ended, or a revoked one still live when it
 * began. Revocation overwrites reviewedAt, so revoked claims use createdAt.
 */
export function isPayoutClaimLiveDuring(
	claim: Claim,
	start: Date,
	end: Date,
): boolean {
	if (claim.status === "active") {
		return (claim.reviewedAt ?? claim.createdAt) < end;
	}
	return (
		claim.status === "revoked" &&
		claim.createdAt < end &&
		claim.revokedAt !== null &&
		claim.revokedAt >= start
	);
}

function utcTimestamp(date: Date): string {
	return date.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Platform-paid traffic of one carrier in [start, end), rounded to cents:
 * BYOK requests pay the carrier directly and cache hits cost nothing, so only
 * credits-mode cost counts. The fee is the margin snapshotted on each request.
 */
export async function sumAirsideCarrierTraffic(
	providerId: string,
	start: Date,
	end: Date,
) {
	const g = globalModelStats;
	const [row] = await db
		.select({
			requestCount: sql<string>`coalesce(sum(${g.requestCount}), 0)::text`,
			gross: sql<string>`round(coalesce(sum(cast(cast(${g.cost} as double precision) as numeric)), 0), 2)::text`,
			fee: sql<string>`round(coalesce(sum(cast(cast(${g.providerMarginAmount} as double precision) as numeric)), 0), 2)::text`,
		})
		.from(g)
		.where(
			and(
				eq(g.usedProvider, providerId),
				eq(g.usedMode, "credits"),
				// dayTimestamp is `timestamp without time zone`: compare UTC strings.
				sql`${g.dayTimestamp} >= ${utcTimestamp(start)}::timestamp`,
				sql`${g.dayTimestamp} < ${utcTimestamp(end)}::timestamp`,
			),
		);
	return {
		requestCount: Number(row?.requestCount ?? 0),
		grossAmount: row?.gross ?? "0.00",
		gatewayFeeAmount: row?.fee ?? "0.00",
	};
}

/**
 * The same traffic as sumAirsideCarrierTraffic, per model, so a carrier can
 * reconcile a statement against its own records. Token counts are integers
 * as strings; amounts are USD rounded to cents.
 */
export async function airsideCarrierTrafficByModel(
	providerId: string,
	start: Date,
	end: Date,
) {
	const g = globalModelStats;
	const money = (column: AnyColumn) =>
		sql<string>`round(sum(cast(cast(${column} as double precision) as numeric)), 2)::text`;
	return await db
		.select({
			model: g.usedModel,
			requestCount: sql<string>`sum(${g.requestCount})::text`,
			cacheHitCount: sql<string>`sum(${g.cacheCount})::text`,
			inputTokens: sql<string>`round(sum(${g.inputTokens}))::text`,
			cachedInputTokens: sql<string>`round(sum(${g.cachedTokens}))::text`,
			cacheWriteTokens: sql<string>`round(sum(${g.cacheWriteTokens}))::text`,
			outputTokens: sql<string>`round(sum(${g.outputTokens}))::text`,
			reasoningTokens: sql<string>`round(sum(${g.reasoningTokens}))::text`,
			grossAmount: money(g.cost),
			gatewayFeeAmount: money(g.providerMarginAmount),
		})
		.from(g)
		.where(
			and(
				eq(g.usedProvider, providerId),
				eq(g.usedMode, "credits"),
				sql`${g.dayTimestamp} >= ${utcTimestamp(start)}::timestamp`,
				sql`${g.dayTimestamp} < ${utcTimestamp(end)}::timestamp`,
			),
		)
		.groupBy(g.usedModel)
		.orderBy(g.usedModel);
}
