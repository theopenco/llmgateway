import { and, eq, getTableName } from "drizzle-orm";

import { providers } from "@llmgateway/models";

import { cdb, drizzleCache } from "./cdb.js";
import { providerClaim } from "./schema.js";

const CARRIER_CACHE_TTL_SECONDS = 300;
const providerClaimTableName = getTableName(providerClaim);

/** Historical provider rows are not catalogue entries. Custom Airside carriers are. */
export async function getCatalogueProviderIds(): Promise<Set<string>> {
	// cdb: every claim write evicts the cached carrier set, so the public
	// catalogue/stats routes otherwise skip the Postgres round trip.
	const carriers = await cdb
		.select({ providerId: providerClaim.providerId })
		.from(providerClaim)
		.where(
			and(eq(providerClaim.kind, "custom"), eq(providerClaim.status, "active")),
		)
		.$withCache({ config: { ex: CARRIER_CACHE_TTL_SECONDS } });
	return new Set([
		...providers.map((provider) => provider.id),
		...carriers.map((carrier) => carrier.providerId),
	]);
}

/**
 * Drizzle evicts the cache alongside the mutation, before the enclosing
 * transaction commits, so a read in that window re-caches the pre-commit
 * claim set. Call this after a claim status transaction has committed.
 */
export async function invalidateProviderClaimCache(): Promise<void> {
	await drizzleCache.onMutate({ tables: [providerClaimTableName] });
}
