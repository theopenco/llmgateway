import { sql } from "@llmgateway/db";
import {
	canonicalUsedModelId,
	modelFamilyLabel,
	models,
	resolveUsedModelFamily,
} from "@llmgateway/models";

import type { SQLWrapper } from "@llmgateway/db";

export type AdminModelView = "mapping" | "canonical" | "provider" | "family";
const familyLabels = JSON.stringify(
	Object.fromEntries(
		models.map((model) => [model.id, modelFamilyLabel(model.family)]),
	),
);
export function modelBreakdownKey(
	usedModel: string,
	usedProvider: string,
	view: AdminModelView,
): string {
	if (view === "provider") {
		return usedProvider || "unknown";
	}
	if (view === "canonical") {
		return canonicalUsedModelId(usedModel);
	}
	if (view === "family") {
		const family = resolveUsedModelFamily(usedModel);
		return family ? modelFamilyLabel(family) : "Unknown family";
	}
	return usedModel;
}
export function modelBreakdownSql(
	table: { usedModel: SQLWrapper; usedProvider: SQLWrapper },
	view: AdminModelView,
) {
	if (view === "mapping") {
		return sql<string>`${table.usedModel}`;
	}
	if (view === "provider") {
		return sql<string>`coalesce(nullif(${table.usedProvider}, ''), 'unknown')`;
	}
	const canonical = sql<string>`split_part(regexp_replace(${table.usedModel}, '^[^/]+/', ''), ':', 1)`;
	return view === "family"
		? sql<string>`coalesce(${familyLabels}::jsonb ->> ${canonical}, 'Unknown family')`
		: canonical;
}
