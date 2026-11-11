import { Decimal } from "decimal.js";
import { z } from "zod";

import { inArray, db, tables } from "@llmgateway/db";
import { providers as catalogueProviders } from "@llmgateway/models";
import {
	AIRSIDE_PAYOUT_STATUSES,
	airsidePayoutAmount,
} from "@llmgateway/shared/airside-billing";

function usd(value: string): string {
	return new Decimal(value).toFixed(2);
}

type StatementRow = typeof tables.airsidePayoutStatement.$inferSelect;

/** Amounts are USD decimal strings with two places. */
export const payoutStatementSchema = z.object({
	id: z.string(),
	providerId: z.string(),
	providerName: z.string(),
	periodStart: z.string(),
	periodEnd: z.string(),
	requestCount: z.number(),
	grossAmount: z.string(),
	gatewayFeeAmount: z.string(),
	adjustmentAmount: z.string(),
	adjustmentNote: z.string().nullable(),
	payoutAmount: z.string(),
	status: z.enum(AIRSIDE_PAYOUT_STATUSES),
	computedAt: z.string(),
	approvedAt: z.string().nullable(),
	paidAt: z.string().nullable(),
	paymentReference: z.string().nullable(),
});

export type PayoutStatement = z.infer<typeof payoutStatementSchema>;

/** Display names of the carriers on `rows`, from their latest claim. */
export async function carrierNames(
	rows: Pick<StatementRow, "providerId">[],
): Promise<Map<string, string>> {
	const providerIds = [...new Set(rows.map((row) => row.providerId))];
	const names = new Map<string, string>();
	if (providerIds.length === 0) {
		return names;
	}
	const claims = await db
		.select({
			providerId: tables.providerClaim.providerId,
			customName: tables.providerClaim.customName,
		})
		.from(tables.providerClaim)
		.where(inArray(tables.providerClaim.providerId, providerIds))
		.orderBy(tables.providerClaim.createdAt);
	for (const claim of claims) {
		if (claim.customName) {
			names.set(claim.providerId, claim.customName);
		}
	}
	for (const providerId of providerIds) {
		if (!names.has(providerId)) {
			names.set(
				providerId,
				catalogueProviders.find((provider) => provider.id === providerId)
					?.name ?? providerId,
			);
		}
	}
	return names;
}

export function serializePayoutStatement(
	row: StatementRow,
	names: Map<string, string>,
): PayoutStatement {
	return {
		id: row.id,
		providerId: row.providerId,
		providerName: names.get(row.providerId) ?? row.providerId,
		periodStart: row.periodStart.toISOString(),
		periodEnd: row.periodEnd.toISOString(),
		requestCount: row.requestCount,
		grossAmount: usd(row.grossAmount),
		gatewayFeeAmount: usd(row.gatewayFeeAmount),
		adjustmentAmount: usd(row.adjustmentAmount),
		adjustmentNote: row.adjustmentNote,
		payoutAmount: airsidePayoutAmount(row).toFixed(2),
		status: row.status,
		computedAt: row.computedAt.toISOString(),
		approvedAt: row.approvedAt?.toISOString() ?? null,
		paidAt: row.paidAt?.toISOString() ?? null,
		paymentReference: row.paymentReference,
	};
}
