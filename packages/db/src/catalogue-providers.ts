import { and, eq } from "drizzle-orm";

import { providers } from "@llmgateway/models";

import { cdb } from "./cdb.js";
import { providerClaim } from "./schema.js";

const CARRIER_CACHE_TTL_SECONDS = 300;

/** Historical provider rows are not catalogue entries. Custom Airside carriers are. */
export async function getCatalogueProviderIds(): Promise<Set<string>> {
	// cdb: claim approval and revocation write through cdb, so the cached
	// carrier set is invalidated on every membership change and the public
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
