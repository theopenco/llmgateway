export type PlanTier = "lite" | "pro" | "max";

// Anchor of the billing page's plan picker, shared with the flows that hand
// over to it.
export const CHANGE_PLAN_SECTION_ID = "change-plan";

export interface PlanOption {
	name: string;
	price: number;
	usage: number;
	description: string;
	tier: PlanTier;
	popular?: boolean;
}
