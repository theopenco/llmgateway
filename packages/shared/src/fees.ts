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
	cardCountry?: string;
}

const STRIPE_FIXED_FEE = 0.3;
const STRIPE_PERCENTAGE_FEE = 0.029;
const INTERNATIONAL_FEE_PERCENTAGE = 0.015;
const PLATFORM_FEE_PERCENTAGE = 0.05; // Fixed 5% for all users

// Fee percentage for BYOK (Bring Your Own Keys) usage - charged on tracked costs
// when users use their own provider API keys
export const BYOK_FEE_PERCENTAGE = parseFloat(
	process.env.BYOK_FEE_PERCENTAGE || "0.01",
);

export function calculateFees(input: FeeCalculationInput): FeeBreakdown {
	const { amount, cardCountry } = input;

	const isInternationalCard = cardCountry && cardCountry !== "US";

	const totalPercentageFees =
		STRIPE_PERCENTAGE_FEE +
		(isInternationalCard ? INTERNATIONAL_FEE_PERCENTAGE : 0) +
		PLATFORM_FEE_PERCENTAGE;

	const totalAmount = (amount + STRIPE_FIXED_FEE) / (1 - totalPercentageFees);

	const stripeFee = totalAmount * STRIPE_PERCENTAGE_FEE + STRIPE_FIXED_FEE;
	const internationalFee = isInternationalCard
		? totalAmount * INTERNATIONAL_FEE_PERCENTAGE
		: 0;
	const planFee = totalAmount * PLATFORM_FEE_PERCENTAGE;

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
