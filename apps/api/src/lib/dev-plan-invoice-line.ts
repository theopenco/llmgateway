import { Decimal } from "decimal.js";

import { getDevPlanCreditsLimit, type DevPlanTier } from "@llmgateway/shared";

/**
 * Invoice line for a DevPass renewal or upgrade, itemizing allowance carried
 * in from the cycle before it.
 */
export function devPlanInvoiceLine(
	kind: "renewal" | "upgrade",
	tier: DevPlanTier,
	rolloverCredits: number,
): string {
	const plan = tier.toUpperCase();
	const label =
		kind === "renewal"
			? `Dev Plan ${plan} renewal`
			: `Dev Plan upgrade to ${plan}`;
	const included = `$${getDevPlanCreditsLimit(tier)} credits included`;
	if (rolloverCredits <= 0) {
		return `${label} (${included})`;
	}
	const carried = new Decimal(rolloverCredits).toFixed(2);
	const verb = kind === "renewal" ? "carried" : "rolled";
	return `${label} (${included} + $${carried} unused credits ${verb} over)`;
}
