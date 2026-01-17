export type PlanTier = "lite" | "pro" | "max";

export interface PlanOption {
	name: string;
	price: number;
	description: string;
	tier: PlanTier;
	popular?: boolean;
}
