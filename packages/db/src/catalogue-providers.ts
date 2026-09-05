import { providers } from "@llmgateway/models";

import { db } from "./db.js";

/** Historical provider rows are not catalogue entries. Custom Airside carriers are. */
export async function getCatalogueProviderIds(): Promise<Set<string>> {
	const carriers = await db.query.providerClaim.findMany({
		where: { kind: { eq: "custom" }, status: { eq: "active" } },
		columns: { providerId: true },
	});
	return new Set([
		...providers.map((provider) => provider.id),
		...carriers.map((carrier) => carrier.providerId),
	]);
}
