import {
	and,
	db,
	eq,
	isPayoutClaimLiveDuring,
	sumAirsideCarrierTraffic,
	tables,
} from "@llmgateway/db";
import { previousUtcMonth } from "@llmgateway/shared/airside-billing";

/**
 * Opens last month's statement for every payout-mode carrier, then refreshes
 * each draft from the daily rollups so late-aggregated traffic lands before an
 * admin approves it. Approved and paid statements are never recomputed.
 * Earlier months are opened by an admin backfill. Returns the number of
 * drafts refreshed.
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
	// Active claims first, so they win a provider that was re-claimed.
	const eligible = claims
		.filter((claim) => isPayoutClaimLiveDuring(claim, start, end))
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
		const totals = await sumAirsideCarrierTraffic(
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
