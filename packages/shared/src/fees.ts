export interface FeeBreakdown {
	baseAmount: number;
	platformFee: number;
	totalAmount: number;
}

export interface FeeCalculationInput {
	amount: number;
}

const PLATFORM_FEE_PERCENTAGE = 0.05; // Fixed 5% for all users

export function calculateFees(input: FeeCalculationInput): FeeBreakdown {
	const { amount } = input;

	const platformFee = amount * PLATFORM_FEE_PERCENTAGE;
	const totalAmount = amount + platformFee;

	return {
		baseAmount: amount,
		platformFee: Math.round(platformFee * 100) / 100,
		totalAmount: Math.round(totalAmount * 100) / 100,
	};
}
