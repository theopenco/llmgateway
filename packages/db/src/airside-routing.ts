/**
 * Airside carrier routing economics, shared by the API (carrier-facing
 * settings) and the gateway (routing election). Deliberately separate from
 * `routing_score_multiplier`: that table is the admin-only prioritization
 * knob, while `provider_routing_settings` carries the carrier's accepted
 * gateway margin and traffic discount — clean percentages that also drive
 * spend reporting.
 */

// The gateway's standard margin. A carrier that accepts a larger margin or
// offers a discount is boosted in routing (and vice versa).
export const AIRSIDE_BASELINE_MARGIN = 0.2;
export const AIRSIDE_MARGIN_MIN = 0.05;
export const AIRSIDE_MARGIN_MAX = 0.5;
export const AIRSIDE_DISCOUNT_MAX = 0.5;

function clampAdjustment(value: number): number {
	const clamped = Math.min(0.9, Math.max(-0.9, value));
	// Round away float artifacts (0.15 - 0.2 - 0.05 !== -0.1 in IEEE754).
	return Math.round(clamped * 10000) / 10000;
}

/**
 * The signed routing-price adjustment a carrier's settings produce
 * (negative = boosted, i.e. routed as if cheaper). Accepting a larger gateway
 * margin or offering a discount lowers the routing price; paying less than
 * the standard margin prices the carrier up.
 */
export function computeAirsideAdjustment(
	discountPercent: number,
	marginPercent: number,
): number {
	return clampAdjustment(
		AIRSIDE_BASELINE_MARGIN - marginPercent - discountPercent,
	);
}
