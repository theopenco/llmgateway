import { z } from "@hono/zod-openapi";

import type { ProviderKeyModelRateLimits } from "@llmgateway/db";

/** Per-credential caps on a provider key; NULL means uncapped. */
export const PROVIDER_KEY_RATE_LIMIT_FIELDS = [
	"maxRpm",
	"maxRpd",
	"maxTpm",
	"maxTpd",
] as const;

export type ProviderKeyRateLimitField =
	(typeof PROVIDER_KEY_RATE_LIMIT_FIELDS)[number];

export const PROVIDER_KEY_RATE_LIMIT_MODES = ["strict", "soft", "lax"] as const;

export type ProviderKeyRateLimitMode =
	(typeof PROVIDER_KEY_RATE_LIMIT_MODES)[number];

export type ProviderKeyRateLimits = Record<
	ProviderKeyRateLimitField,
	number | null
> & {
	rateLimitMode: ProviderKeyRateLimitMode;
	modelRateLimits: ProviderKeyModelRateLimits | null;
};

type ProviderKeyRateLimitInput = Partial<
	Record<ProviderKeyRateLimitField, number | null | undefined>
> & {
	rateLimitMode?: ProviderKeyRateLimitMode;
	modelRateLimits?: ProviderKeyModelRateLimits | null;
};

/** Most models one key may carry caps for. */
export const MAX_MODEL_RATE_LIMITS = 200;

// The cap columns are Postgres `integer`.
export const PG_INTEGER_MAX = 2_147_483_647;

const rateLimitValueSchema = z
	.number()
	.int("Rate limits must be whole numbers")
	.min(1, "Rate limits must be at least 1")
	.max(PG_INTEGER_MAX, `Rate limits must be at most ${PG_INTEGER_MAX}`)
	.nullable()
	.optional();

const modelRateLimitInputSchema = z
	.object({
		maxRpm: rateLimitValueSchema,
		maxRpd: rateLimitValueSchema,
		maxTpm: rateLimitValueSchema,
		maxTpd: rateLimitValueSchema,
	})
	.strict();

const modelRateLimitOutputSchema = z.object({
	maxRpm: z.number().int().nullable().optional(),
	maxRpd: z.number().int().nullable().optional(),
	maxTpm: z.number().int().nullable().optional(),
	maxTpd: z.number().int().nullable().optional(),
});

/**
 * Request fields for setting a provider key's caps: requests per minute/day
 * and prompt + completion tokens per minute/day. `null` clears a cap, an
 * omitted field leaves it unchanged. `rateLimitMode` decides who a capped key
 * still serves, like `rate_limit.mode`: "soft" keeps sessions already pinned
 * to the provider, "lax" also explicit `provider/model` requests.
 * `modelRateLimits` adds caps for single models, keyed by canonical model id;
 * it replaces the whole map, and `null` clears it.
 */
export const providerKeyRateLimitsInputShape = {
	maxRpm: rateLimitValueSchema,
	maxRpd: rateLimitValueSchema,
	maxTpm: rateLimitValueSchema,
	maxTpd: rateLimitValueSchema,
	rateLimitMode: z.enum(PROVIDER_KEY_RATE_LIMIT_MODES).optional(),
	modelRateLimits: z
		.record(z.string().trim().min(1).max(200), modelRateLimitInputSchema)
		.refine(
			(limits) => Object.keys(limits).length <= MAX_MODEL_RATE_LIMITS,
			`At most ${MAX_MODEL_RATE_LIMITS} models can have their own limits`,
		)
		.nullable()
		.optional(),
};

export const providerKeyRateLimitsOutputShape = {
	maxRpm: z.number().int().nullable(),
	maxRpd: z.number().int().nullable(),
	maxTpm: z.number().int().nullable(),
	maxTpd: z.number().int().nullable(),
	rateLimitMode: z.enum(PROVIDER_KEY_RATE_LIMIT_MODES),
	modelRateLimits: z.record(z.string(), modelRateLimitOutputSchema).nullable(),
};

/**
 * Drops uncapped windows and models left with none, sorted by model id so
 * stored maps compare by value. An empty map becomes NULL.
 */
export function normalizeModelRateLimits(
	limits: ProviderKeyModelRateLimits | null | undefined,
): ProviderKeyModelRateLimits | null {
	if (!limits) {
		return null;
	}
	const normalized: ProviderKeyModelRateLimits = {};
	for (const model of Object.keys(limits).sort()) {
		const caps: ProviderKeyModelRateLimits[string] = {};
		for (const field of PROVIDER_KEY_RATE_LIMIT_FIELDS) {
			const value = limits[model][field];
			if (typeof value === "number") {
				caps[field] = value;
			}
		}
		if (Object.keys(caps).length > 0) {
			normalized[model.trim()] = caps;
		}
	}
	return Object.keys(normalized).length > 0 ? normalized : null;
}

/**
 * Model ids a normalized `modelRateLimits` map newly caps, for catalogue
 * validation. Ids the key already had caps for are skipped, so a model retired
 * since does not block unrelated edits.
 */
export function modelRateLimitModelIds(
	limits: ProviderKeyModelRateLimits | null,
	stored?: ProviderKeyModelRateLimits | null,
): string[] | null {
	const ids = Object.keys(limits ?? {}).filter(
		(model) => !stored || !Object.hasOwn(stored, model),
	);
	return ids.length > 0 ? ids : null;
}

export function pickProviderKeyRateLimits(
	row: ProviderKeyRateLimits,
): ProviderKeyRateLimits {
	return {
		maxRpm: row.maxRpm,
		maxRpd: row.maxRpd,
		maxTpm: row.maxTpm,
		maxTpd: row.maxTpd,
		rateLimitMode: row.rateLimitMode,
		modelRateLimits: row.modelRateLimits,
	};
}

/** The caps an input sets, leaving out the ones it omits. */
export function providerKeyRateLimitUpdates(
	input: ProviderKeyRateLimitInput,
): Partial<ProviderKeyRateLimits> {
	const updates: Partial<ProviderKeyRateLimits> = {};
	for (const field of PROVIDER_KEY_RATE_LIMIT_FIELDS) {
		const value = input[field];
		if (value !== undefined) {
			updates[field] = value;
		}
	}
	if (input.rateLimitMode !== undefined) {
		updates.rateLimitMode = input.rateLimitMode;
	}
	if (input.modelRateLimits !== undefined) {
		updates.modelRateLimits = normalizeModelRateLimits(input.modelRateLimits);
	}
	return updates;
}

/** Audit-log diff of the caps an update actually changes. */
export function providerKeyRateLimitChanges(
	before: ProviderKeyRateLimits,
	updates: Partial<ProviderKeyRateLimits>,
): Record<string, { old: unknown; new: unknown }> {
	const changes: Record<string, { old: unknown; new: unknown }> = {};
	for (const field of [
		...PROVIDER_KEY_RATE_LIMIT_FIELDS,
		"rateLimitMode",
	] as const) {
		const value = updates[field];
		if (value !== undefined && before[field] !== value) {
			changes[field] = { old: before[field], new: value };
		}
	}
	if (
		updates.modelRateLimits !== undefined &&
		JSON.stringify(normalizeModelRateLimits(before.modelRateLimits)) !==
			JSON.stringify(updates.modelRateLimits)
	) {
		changes.modelRateLimits = {
			old: before.modelRateLimits,
			new: updates.modelRateLimits,
		};
	}
	return changes;
}
