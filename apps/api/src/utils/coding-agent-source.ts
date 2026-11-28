import { sql } from "@llmgateway/db";

import type { AnyColumn } from "@llmgateway/db";

// Historical rollups still contain the source used before the Mezair rename.
export function canonicalMezairSource(source: AnyColumn) {
	return sql<string>`case when ${source} = 'anvil' then 'mezair' else ${source} end`;
}
