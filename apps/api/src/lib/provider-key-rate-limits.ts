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

export type ProviderKeyRateLimits = Record<
	ProviderKeyRateLimitField,
	number | null
>;

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
 * omitted field leaves it unchanged.
 */
export const providerKeyRateLimitsInputShape = {
	maxRpm: rateLimitValueSchema,
	maxRpd: rateLimitValueSchema,
	maxTpm: rateLimitValueSchema,
	maxTpd: rateLimitValueSchema,
};

export const providerKeyRateLimitsOutputShape = {
	maxRpm: z.number().int().nullable(),
	maxRpd: z.number().int().nullable(),
	maxTpm: z.number().int().nullable(),
	maxTpd: z.number().int().nullable(),
};

export function pickProviderKeyRateLimits(
	row: ProviderKeyRateLimits,
): ProviderKeyRateLimits {
	return {
		maxRpm: row.maxRpm,
		maxRpd: row.maxRpd,
		maxTpm: row.maxTpm,
		maxTpd: row.maxTpd,
	};
}

/** The caps an input sets, leaving out the ones it omits. */
export function providerKeyRateLimitUpdates(
	input: Partial<Record<ProviderKeyRateLimitField, number | null | undefined>>,
): Partial<ProviderKeyRateLimits> {
	const updates: Partial<ProviderKeyRateLimits> = {};
	for (const field of PROVIDER_KEY_RATE_LIMIT_FIELDS) {
		const value = input[field];
		if (value !== undefined) {
			updates[field] = value;
		}
	}
	return updates;
}

/** Audit-log diff of the caps an update actually changes. */
export function providerKeyRateLimitChanges(
	before: ProviderKeyRateLimits,
	updates: Partial<ProviderKeyRateLimits>,
): Record<string, { old: number | null; new: number | null }> {
	const changes: Record<string, { old: number | null; new: number | null }> =
		{};
	for (const field of PROVIDER_KEY_RATE_LIMIT_FIELDS) {
		const value = updates[field];
		if (value !== undefined && before[field] !== value) {
			changes[field] = { old: before[field], new: value };
		}
	}
	return changes;
}
