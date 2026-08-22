import { sql } from "@llmgateway/db";

import type { SQL, SQLWrapper } from "@llmgateway/db";

export const PLAYGROUND_ANALYTICS_KEY = "playground";
export const PLAYGROUND_ANALYTICS_LABEL = "Playground";

export function apiKeyAnalyticsId(
	apiKeyId: SQLWrapper,
	apiKeyKind: SQLWrapper,
): SQL<string> {
	return sql<string>`CASE WHEN ${apiKeyKind} = 'playground' THEN 'playground' ELSE ${apiKeyId} END`;
}

export function apiKeyAnalyticsLabel(
	description: SQLWrapper,
	apiKeyKind: SQLWrapper,
): SQL<string> {
	return sql<string>`CASE WHEN ${apiKeyKind} = 'playground' THEN 'Playground' ELSE ${description} END`;
}

export function countAnalyticsApiKeys(
	keys: { id: string; kind: string }[],
): number {
	return new Set(
		keys.map((key) =>
			key.kind === "playground" ? PLAYGROUND_ANALYTICS_KEY : key.id,
		),
	).size;
}
