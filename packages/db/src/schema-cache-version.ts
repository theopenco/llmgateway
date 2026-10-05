import { createHash } from "node:crypto";

import { getTableColumns, getTableName, is, Table } from "drizzle-orm";

import * as schema from "./schema.js";

/**
 * Fingerprint of the column layout every cached row was serialized with.
 *
 * Drizzle's query cache stores what the driver returned, and node-postgres
 * returns *positional* rows (`rowMode: "array"`); the column names are applied
 * afterwards from the field list of whatever code reads the entry. A schema
 * change therefore does not merely make a cached row stale — it shifts every
 * value after the changed column into the neighbouring property, so an active
 * API key can come back with another column's value in `status` and be
 * rejected as "not active".
 *
 * Deriving the cache namespace from the layout makes entries written under a
 * different set of columns unreachable rather than silently misread, and it
 * updates itself: a migration always lands with its `schema.ts` change, so no
 * one has to remember to bump a version constant.
 */
export function computeSchemaCacheVersion(
	source: Record<string, unknown>,
): string {
	const signatures = new Set<string>();

	for (const value of Object.values(source)) {
		if (!is(value, Table)) {
			continue;
		}
		// Column order matters as much as the names: it is what the positional
		// rows are mapped back onto.
		const columns = Object.values(getTableColumns(value)).map(
			(column) => `${column.name}:${column.getSQLType()}`,
		);
		signatures.add(`${getTableName(value)}(${columns.join(",")})`);
	}

	return createHash("sha256")
		.update([...signatures].sort().join("|"))
		.digest("hex")
		.slice(0, 16);
}

export const SCHEMA_CACHE_VERSION = computeSchemaCacheVersion(schema);
