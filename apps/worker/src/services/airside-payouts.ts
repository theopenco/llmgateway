import { Decimal } from "decimal.js";

import { and, db, eq, sql, tables } from "@llmgateway/db";
import { previousUtcMonth } from "@llmgateway/shared/airside-billing";

import { formatUTCTimestamp } from "./project-stats-aggregator.js";

function cents(value: string): string {
	return new Decimal(value).toDecimalPlaces(2).toFixed(2);
}

/**
 * Platform-paid traffic of one carrier in [start, end): BYOK requests pay the
 * carrier directly and cache hits cost nothing, so only credits-mode cost
 * counts. The fee is the margin snapshotted on each request.
 */
async function sumCarrierTraffic(providerId: string, start: Date, end: Date) {
	const g = tables.globalModelStats;
	const [row] = await db
		.select({
			requestCount: sql<string>`coalesce(sum(${g.requestCount}), 0)::text`,
			gross: sql<string>`coalesce(sum(cast(cast(${g.cost} as double precision) as numeric)), 0)::text`,
			fee: sql<string>`coalesce(sum(cast(cast(${g.providerMarginAmount} as double precision) as numeric)), 0)::text`,
		})
		.from(g)
		.where(
			and(
				eq(g.usedProvider, providerId),
				eq(g.usedMode, "credits"),
				// dayTimestamp is `timestamp without time zone`: compare UTC strings.
				sql`${g.dayTimestamp} >= ${formatUTCTimestamp(start)}::timestamp`,
				sql`${g.dayTimestamp} < ${formatUTCTimestamp(end)}::timestamp`,
			),
		);
	return {
		requestCount: Number(row?.requestCount ?? 0),
		grossAmount: cents(row?.gross ?? "0"),
		gatewayFeeAmount: cents(row?.fee ?? "0"),
	};
}

/**
 * Opens last month's statement for every payout-mode carrier, then refreshes
 * each draft from the daily rollups so late-aggregated traffic lands before an
 * admin approves it. Approved and paid statements are never recomputed.
 * Returns the number of drafts refreshed.
 */
export async function refreshAirsidePayoutStatements(
	now: Date = new Date(),
): Promise<number> {
	const { start, end } = previousUtcMonth(now);
	const claims = await db.query.providerClaim.findMany({
		where: {
			billingMode: { eq: "payout" },
			status: { in: ["active", "revoked"] },
		},
		columns: {
			providerId: true,
			providerCompanyId: true,
			status: true,
			createdAt: true,
			reviewedAt: true,
			revokedAt: true,
		},
	});
	// Live during the month: an active claim approved before it ended, or a
	// revoked one still live when it began (revocation overwrites reviewedAt,
	// so that is not the approval time there). Active claims first, so they
	// win a provider that was re-claimed.
	const eligible = claims
		.filter((claim) =>
			claim.status === "active"
				? (claim.reviewedAt ?? claim.createdAt) < end
				: claim.createdAt < end &&
					claim.revokedAt !== null &&
					claim.revokedAt >= start,
		)
		.sort(
			(a, b) => Number(b.status === "active") - Number(a.status === "active"),
		);
	for (const claim of eligible) {
		await db
			.insert(tables.airsidePayoutStatement)
			.values({
				providerCompanyId: claim.providerCompanyId,
				providerId: claim.providerId,
				periodStart: start,
				periodEnd: end,
			})
			.onConflictDoNothing();
	}

	const drafts = await db.query.airsidePayoutStatement.findMany({
		where: { status: { eq: "draft" } },
		columns: { id: true, providerId: true, periodStart: true, periodEnd: true },
	});
	for (const draft of drafts) {
		const totals = await sumCarrierTraffic(
			draft.providerId,
			draft.periodStart,
			draft.periodEnd,
		);
		await db
			.update(tables.airsidePayoutStatement)
			.set({ ...totals, computedAt: new Date() })
			.where(
				and(
					eq(tables.airsidePayoutStatement.id, draft.id),
					// An approval between the read and this write wins.
					eq(tables.airsidePayoutStatement.status, "draft"),
				),
			);
	}
	return drafts.length;
}
