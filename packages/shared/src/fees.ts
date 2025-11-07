export interface FeeBreakdown {
	baseAmount: number;
	stripeFee: number;
	internationalFee: number;
	planFee: number;
	totalFees: number;
	totalAmount: number;
}

export interface FeeCalculationInput {
	amount: number;
	organizationPlan: "free" | "pro";
	cardCountry?: string;
}

const STRIPE_FIXED_FEE = 0.3;
const STRIPE_PERCENTAGE_FEE = 0.029;
const INTERNATIONAL_FEE_PERCENTAGE = 0.015;
const FREE_PLAN_FEE_PERCENTAGE = 0.05;

export function calculateFees(input: FeeCalculationInput): FeeBreakdown {
	const { amount, organizationPlan, cardCountry } = input;

	const isInternationalCard = cardCountry && cardCountry !== "US";

	const totalPercentageFees =
		STRIPE_PERCENTAGE_FEE +
		(isInternationalCard ? INTERNATIONAL_FEE_PERCENTAGE : 0) +
		(organizationPlan === "free" ? FREE_PLAN_FEE_PERCENTAGE : 0);

	const totalAmount = (amount + STRIPE_FIXED_FEE) / (1 - totalPercentageFees);

	const stripeFee = totalAmount * STRIPE_PERCENTAGE_FEE + STRIPE_FIXED_FEE;
	const internationalFee = isInternationalCard
		? totalAmount * INTERNATIONAL_FEE_PERCENTAGE
		: 0;
	const planFee =
		organizationPlan === "free" ? totalAmount * FREE_PLAN_FEE_PERCENTAGE : 0;

	const totalFees = stripeFee + internationalFee + planFee;

	return {
		baseAmount: amount,
		stripeFee: Math.round(stripeFee * 100) / 100,
		internationalFee: Math.round(internationalFee * 100) / 100,
		planFee: Math.round(planFee * 100) / 100,
		totalFees: Math.round(totalFees * 100) / 100,
		totalAmount: Math.round(totalAmount * 100) / 100,
	};
}
