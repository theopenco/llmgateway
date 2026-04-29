import { HTTPException } from "hono/http-exception";

import type { InferSelectModel } from "@llmgateway/db";
import type { tables } from "@llmgateway/db";
import type { ModelDefinition } from "@llmgateway/models";

type Organization = InferSelectModel<typeof tables.organization>;

export const EXPENSIVE_MODEL_MIN_ACCOUNT_AGE_DAYS = 14;

/**
 * Price thresholds (USD per million tokens) above which a model is considered
 * expensive. A model is expensive when its cheapest provider has BOTH an
 * input price >= input threshold AND an output price >= output threshold.
 *
 * Calibrated so that GPT pro models (gpt-5-pro: $15/$120, up to gpt-5.5-pro:
 * $30/$180) are expensive, while flagship non-pro and legacy models stay
 * unrestricted (claude-opus-4-7: $5/$25, gpt-5.5: $5/$30, gpt-4: $30/$60).
 */
export const EXPENSIVE_MODEL_INPUT_PRICE_USD_PER_MILLION = 10;
export const EXPENSIVE_MODEL_OUTPUT_PRICE_USD_PER_MILLION = 100;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const TOKENS_PER_MILLION = 1_000_000;

function parsePrice(value: string | undefined): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	const parsed = parseFloat(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

export function isExpensiveModel(
	model: ModelDefinition,
	inputThresholdPerMillion: number = EXPENSIVE_MODEL_INPUT_PRICE_USD_PER_MILLION,
	outputThresholdPerMillion: number = EXPENSIVE_MODEL_OUTPUT_PRICE_USD_PER_MILLION,
): boolean {
	const inputThreshold = inputThresholdPerMillion / TOKENS_PER_MILLION;
	const outputThreshold = outputThresholdPerMillion / TOKENS_PER_MILLION;

	let minInput: number | undefined;
	let minOutput: number | undefined;

	for (const provider of model.providers) {
		const input = parsePrice(provider.inputPrice);
		const output = parsePrice(provider.outputPrice);
		if (input !== undefined && (minInput === undefined || input < minInput)) {
			minInput = input;
		}
		if (
			output !== undefined &&
			(minOutput === undefined || output < minOutput)
		) {
			minOutput = output;
		}
	}

	if (minInput === undefined || minOutput === undefined) {
		return false;
	}

	return minInput >= inputThreshold && minOutput >= outputThreshold;
}

export function getAccountAgeDays(
	organization: Pick<Organization, "createdAt">,
	now: Date = new Date(),
): number {
	const ageMs = now.getTime() - organization.createdAt.getTime();
	return ageMs / MS_PER_DAY;
}

/**
 * Throws an HTTPException(403) when the organization is not allowed to use
 * the requested expensive model. No-op for non-expensive models.
 *
 * Access is granted only when the organization's account age is at least
 * EXPENSIVE_MODEL_MIN_ACCOUNT_AGE_DAYS days.
 */
export function validateExpensiveModelAccess(
	organization: Pick<Organization, "createdAt">,
	model: ModelDefinition,
	now: Date = new Date(),
): void {
	if (!isExpensiveModel(model)) {
		return;
	}

	const accountAgeDays = getAccountAgeDays(organization, now);
	if (accountAgeDays < EXPENSIVE_MODEL_MIN_ACCOUNT_AGE_DAYS) {
		throw new HTTPException(403, {
			message: `Model ${model.id} requires an account at least ${EXPENSIVE_MODEL_MIN_ACCOUNT_AGE_DAYS} days old. Please use a different model or try again later.`,
		});
	}
}
