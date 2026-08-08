/**
 * Spend-limit helpers shared by the managed-credential manager and the
 * per-organization BYOK provider-key table. Both render the same lifetime
 * `provider_key.usage` counter against the same cap, so the formatting and the
 * "is this key still usable" rule live in one place.
 */

export interface SpendLimited {
	status?: string | null;
	usage: string;
	usageLimit: string | null;
}

/** Share of the cap at which the UI starts warning. */
const WARNING_THRESHOLD = 0.8;

export type SpendLimitState =
	/** No cap configured. */
	| "none"
	/** Under the warning threshold. */
	| "ok"
	/** Close enough to the cap that it will likely trip soon. */
	| "warning"
	/**
	 * At or over the cap but still active: enforcement is lagged by one billing
	 * worker batch, so the gateway can still select this key for a few seconds.
	 */
	| "reached-pending"
	/** At or over the cap and deactivated — out of rotation. */
	| "reached";

export function formatUsd(value: string): string {
	const amount = Number(value);
	return Number.isFinite(amount) ? `$${amount.toFixed(2)}` : `$${value}`;
}

/**
 * Fraction of the configured cap consumed, or null when uncapped. Not clamped:
 * a key can finish a batch slightly over its cap before the worker turns it off.
 */
export function spendLimitFraction(key: SpendLimited): number | null {
	if (key.usageLimit === null) {
		return null;
	}
	const limit = Number(key.usageLimit);
	if (!Number.isFinite(limit) || limit <= 0) {
		return null;
	}
	return Number(key.usage) / limit;
}

export function getSpendLimitState(key: SpendLimited): SpendLimitState {
	const fraction = spendLimitFraction(key);
	if (fraction === null) {
		return "none";
	}
	if (fraction >= 1) {
		// Deliberately independent of status: the cap is crossed the moment the
		// worker credits the spend, and the status flip lands one batch later.
		// Reporting "active" in that window would tell an operator the key is
		// fine seconds before it turns itself off.
		return key.status === "active" ? "reached-pending" : "reached";
	}
	return fraction >= WARNING_THRESHOLD ? "warning" : "ok";
}

/**
 * Whether the gateway will consider this key at all. Provider-key selection
 * filters on `status = 'active'`, so anything else is skipped regardless of
 * its position in the rotation order.
 */
export function isInRotation(key: SpendLimited): boolean {
	return key.status === "active";
}
