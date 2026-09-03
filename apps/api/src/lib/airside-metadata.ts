import { z } from "zod";

import type { AirsideModelMetadataChanges, tables } from "@llmgateway/db";

export const REASONING_EFFORT_VALUES = [
	"none",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;

export const reasoningEffortsValue = z
	.array(z.enum(REASONING_EFFORT_VALUES))
	.max(7);

/** Non-price fields a carrier may change on a listing. On an active listing
 *  the diff is filed for admin approval instead of applied. */
export const airsideModelMetadataSchema = z.object({
	displayName: z.string().max(200).nullish(),
	description: z.string().max(2000).nullish(),
	family: z.string().min(1).max(100).optional(),
	contextSize: z.number().int().positive().nullish(),
	maxOutput: z.number().int().positive().nullish(),
	streaming: z.boolean().optional(),
	vision: z.boolean().optional(),
	audio: z.boolean().optional(),
	tools: z.boolean().optional(),
	jsonOutput: z.boolean().optional(),
	jsonOutputSchema: z.boolean().optional(),
	reasoning: z.boolean().optional(),
	reasoningMaxTokens: z.boolean().optional(),
	reasoningEfforts: reasoningEffortsValue.nullish(),
	webSearch: z.boolean().optional(),
	maxRpm: z.number().int().positive().nullish(),
	maxRpd: z.number().int().positive().nullish(),
	rateLimitScope: z.enum(["global", "per_org"]).optional(),
});

export type AirsideModelMetadataInput = z.infer<
	typeof airsideModelMetadataSchema
>;

type DraftModelRow = typeof tables.providerDraftModel.$inferSelect;

/** Drop undefined keys so an empty diff is detectable and JSON-safe. */
export function pickMetadataChanges(
	body: AirsideModelMetadataInput,
): AirsideModelMetadataChanges {
	return Object.fromEntries(
		Object.entries(body).filter(([, value]) => value !== undefined),
	) as AirsideModelMetadataChanges;
}

/** Only the keys whose value differs from the listing's current row, so an
 *  unchanged save is a no-op instead of a filing. */
export function diffMetadataChanges(
	row: DraftModelRow,
	changes: AirsideModelMetadataChanges,
): AirsideModelMetadataChanges {
	return Object.fromEntries(
		Object.entries(changes).filter(
			([key, value]) =>
				JSON.stringify(value) !==
				JSON.stringify(row[key as keyof AirsideModelMetadataChanges]),
		),
	) as AirsideModelMetadataChanges;
}

/** The listing's current values for exactly the keys a filing proposes. */
export function currentMetadataFor(
	row: DraftModelRow,
	changes: AirsideModelMetadataChanges,
): AirsideModelMetadataChanges {
	const current: Record<string, unknown> = {};
	for (const key of Object.keys(
		changes,
	) as (keyof AirsideModelMetadataChanges)[]) {
		current[key] = row[key];
	}
	return current as AirsideModelMetadataChanges;
}
