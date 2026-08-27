import { isNotNull, notInArray } from "drizzle-orm";

import { db } from "./db.js";
import { modelProviderMapping } from "./schema.js";

import type { AnyColumn, SQL } from "drizzle-orm";

/**
 * Restrict mapping-history rows to the region-less root row of each mapping.
 *
 * A provider mapping with `regions` is expanded into a root entry plus one
 * entry per region, and every one of them gets its own history row. The minute
 * aggregator merges the regional traffic **into** the root row (see
 * calculateMappingHistoryForMinute), so the root row is already the provider
 * total for that model. Summing every row of a provider therefore counts
 * regional traffic twice — a provider whose traffic is entirely regional
 * reports exactly double its real request count.
 *
 * Any query that aggregates history across a provider's mappings has to apply
 * this. Queries that deliberately scope to one regional mapping (by mapping id
 * or region) must not.
 *
 * Rows whose mapping id no longer exists in `model_provider_mapping` are kept:
 * the exclusion lists regional mapping ids rather than requiring a join, so
 * orphaned history keeps contributing instead of silently disappearing.
 */
export function excludeRegionalMappingRows(table: {
	modelProviderMappingId: AnyColumn;
}): SQL {
	return notInArray(
		table.modelProviderMappingId,
		db
			.select({ id: modelProviderMapping.id })
			.from(modelProviderMapping)
			.where(isNotNull(modelProviderMapping.region)),
	);
}
