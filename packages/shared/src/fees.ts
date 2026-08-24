export interface FeeBreakdown {
	baseAmount: number;
	platformFee: number;
	internationalFee: number;
	totalAmount: number;
}

export interface FeeCalculationInput {
	amount: number;
	isInternational?: boolean;
}

export const CREDIT_TOP_UP_MIN_AMOUNT = 10;
export const CREDIT_TOP_UP_MAX_AMOUNT = 5000;

export const AUTO_TOP_UP_DEFAULT_THRESHOLD = 5;
export const AUTO_TOP_UP_DEFAULT_AMOUNT = 20;

export function isCreditTopUpAmountInRange(amount: number): boolean {
	return (
		Number.isInteger(amount) &&
		amount >= CREDIT_TOP_UP_MIN_AMOUNT &&
		amount <= CREDIT_TOP_UP_MAX_AMOUNT
	);
}

export function getMaxCreditTopUpAmount(
	grossAllowanceUsd: number,
	isInternational: boolean,
): number {
	if (!Number.isFinite(grossAllowanceUsd)) {
		return CREDIT_TOP_UP_MAX_AMOUNT;
	}

	let low = 0;
	let high = CREDIT_TOP_UP_MAX_AMOUNT;
	while (low < high) {
		const candidate = Math.ceil((low + high) / 2);
		if (
			calculateFees({ amount: candidate, isInternational }).totalAmount <=
			grossAllowanceUsd
		) {
			low = candidate;
		} else {
			high = candidate - 1;
		}
	}

	return low;
}

const PLATFORM_FEE_PERCENTAGE = 0.05;
export const INTERNATIONAL_CARD_FEE_PERCENTAGE = 0.015;

export function calculateFees(input: FeeCalculationInput): FeeBreakdown {
	const { amount, isInternational = false } = input;

	const platformFee = amount * PLATFORM_FEE_PERCENTAGE;
	const internationalFee = isInternational
		? amount * INTERNATIONAL_CARD_FEE_PERCENTAGE
		: 0;
	const totalAmount = amount + platformFee + internationalFee;

	return {
		baseAmount: amount,
		platformFee: Math.round(platformFee * 100) / 100,
		internationalFee: Math.round(internationalFee * 100) / 100,
		totalAmount: Math.round(totalAmount * 100) / 100,
	};
}
