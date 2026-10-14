import { z } from "@hono/zod-openapi";

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
> & { rateLimitMode: ProviderKeyRateLimitMode };

type ProviderKeyRateLimitInput = Partial<
	Record<ProviderKeyRateLimitField, number | null | undefined>
> & { rateLimitMode?: ProviderKeyRateLimitMode };

// The cap columns are Postgres `integer`.
export const PG_INTEGER_MAX = 2_147_483_647;

const rateLimitValueSchema = z
	.number()
	.int("Rate limits must be whole numbers")
	.min(1, "Rate limits must be at least 1")
	.max(PG_INTEGER_MAX, `Rate limits must be at most ${PG_INTEGER_MAX}`)
	.nullable()
	.optional();

/**
 * Request fields for setting a provider key's caps: requests per minute/day
 * and prompt + completion tokens per minute/day. `null` clears a cap, an
 * omitted field leaves it unchanged. `rateLimitMode` decides who a capped key
 * still serves, like `rate_limit.mode`: "soft" keeps sessions already pinned
 * to the provider, "lax" also explicit `provider/model` requests.
 */
export const providerKeyRateLimitsInputShape = {
	maxRpm: rateLimitValueSchema,
	maxRpd: rateLimitValueSchema,
	maxTpm: rateLimitValueSchema,
	maxTpd: rateLimitValueSchema,
	rateLimitMode: z.enum(PROVIDER_KEY_RATE_LIMIT_MODES).optional(),
};

export const providerKeyRateLimitsOutputShape = {
	maxRpm: z.number().int().nullable(),
	maxRpd: z.number().int().nullable(),
	maxTpm: z.number().int().nullable(),
	maxTpd: z.number().int().nullable(),
	rateLimitMode: z.enum(PROVIDER_KEY_RATE_LIMIT_MODES),
};

export function pickProviderKeyRateLimits(
	row: ProviderKeyRateLimits,
): ProviderKeyRateLimits {
	return {
		maxRpm: row.maxRpm,
		maxRpd: row.maxRpd,
		maxTpm: row.maxTpm,
		maxTpd: row.maxTpd,
		rateLimitMode: row.rateLimitMode,
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
	return changes;
}
