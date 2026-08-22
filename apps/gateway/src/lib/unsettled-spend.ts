import { Decimal } from "decimal.js";

import { swrWrap } from "@llmgateway/cache";
import { and, cdb, eq, getTableName, isNull, log, sql } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

// Matches the realtime unsettled-spend gate: long enough to collapse a burst's
// per-request scans into one query, short enough that a settled batch stops
// counting against the balance quickly.
const UNSETTLED_SPEND_TTL_SECONDS = 2;

/**
 * Spend the organization has already incurred but the worker has not yet
 * debited from its balance: log rows awaiting batch credit processing
 * (`processed_at IS NULL`), summed with the worker's exact debit rules from
 * `batchProcessLogs` — data-storage cost for every row, plus
 * `billingCost ?? cost` for non-cached credits-mode rows that are not
 * end-user-wallet funded.
 *
 * Billing is post-paid (stream end → log queue → worker batch debit) and the
 * gateway's organization read is cached, so a credit gate that only looks at
 * the stored balance keeps admitting requests on a stale positive balance for
 * as long as that pipeline lags — an org can run far past zero during a
 * backlog. Subtracting this sum bounds the overshoot to roughly one cache
 * window plus requests still in flight. Rows still streaming or still in the
 * Redis log queue are not visible here; that residue is the small negative
 * balance we accept.
 *
 * This intentionally reads the `log` table: unprocessed rows exist nowhere
 * else (the aggregation tables only see settled data).
 *
 * Fail-open: returns 0 on error so an unavailable read never blocks traffic.
 */
export async function getUnsettledOrganizationSpend(
	organizationId: string,
): Promise<Decimal> {
	try {
		const rows = await swrWrap(
			`orgUnsettledSpend:${organizationId}`,
			[getTableName(log)],
			async () =>
				await cdb
					.select({
						total: sql<string | null>`sum(
							coalesce(${log.dataStorageCost}, 0)
							+ case
								when ${log.usedMode} = 'credits'
									and ${log.cached} is not true
									and ${log.endCustomerWalletId} is null
								then coalesce(${log.billingCost}, ${log.cost}::float8::numeric, 0)
								else 0
							end
						)`,
					})
					.from(log)
					.where(
						and(
							eq(log.organizationId, organizationId),
							isNull(log.processedAt),
						),
					)
					.$withCache({
						tag: `org-unsettled-spend:${organizationId}`,
						autoInvalidate: false,
						config: { ex: UNSETTLED_SPEND_TTL_SECONDS },
					}),
		);
		return new Decimal(rows[0]?.total ?? "0");
	} catch (error) {
		logger.error(
			"Failed to read unsettled organization spend",
			error as Error,
			{ organizationId },
		);
		return new Decimal(0);
	}
}
