/**
 * Spend-limit helpers shared by the managed-credential manager and the
 * per-organization BYOK provider-key table. Both render the same lifetime
 * `provider_key.usage` counter against the same cap, so the formatting and the
 * "did the worker turn this off" rule live in one place.
 */

export interface SpendLimited {
	status?: string | null;
	usage: string;
	usageLimit: string | null;
}

export function formatUsd(value: string): string {
	const amount = Number(value);
	return Number.isFinite(amount) ? `$${amount.toFixed(2)}` : `$${value}`;
}

/**
 * A key the worker auto-deactivated because its attributed spend reached the
 * configured cap. Derived, not stored: an inactive key whose usage sits at or
 * above its limit can only have gotten there via the worker (reactivating it
 * without raising the limit is rejected by the API).
 */
export function hasReachedSpendLimit(key: SpendLimited): boolean {
	return (
		key.status === "inactive" &&
		key.usageLimit !== null &&
		Number(key.usage) >= Number(key.usageLimit)
	);
}
