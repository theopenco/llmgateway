import { Decimal } from "decimal.js";
import { expect, test, vi } from "vitest";

import { calculateCosts } from "./costs.js";

vi.mock("@llmgateway/db", () => ({
	getEffectiveDiscount: async () => ({ discount: "0", source: "none" }),
}));

test.each([
	{ promptTokens: 524287, input: "0.3e-6", output: "1.2e-6", cache: "0.06e-6" },
	{ promptTokens: 524288, input: "0.6e-6", output: "2.4e-6", cache: "0.12e-6" },
	{ promptTokens: 524289, input: "0.6e-6", output: "2.4e-6", cache: "0.12e-6" },
])(
	"Novita M3 bills the correct tier at $promptTokens prompt tokens",
	async ({ promptTokens, input, output, cache }) => {
		const result = await calculateCosts(
			"minimax-m3",
			"novita",
			null,
			promptTokens,
			10,
			100,
		);
		const inputCost = new Decimal(promptTokens).minus(100).mul(input);
		const outputCost = new Decimal(10).mul(output);
		const cachedInputCost = new Decimal(100).mul(cache);
		expect(result.inputCost).toBeCloseTo(inputCost.toNumber(), 12);
		expect(result.outputCost).toBeCloseTo(outputCost.toNumber(), 12);
		expect(result.cachedInputCost).toBeCloseTo(cachedInputCost.toNumber(), 12);
		expect(result.totalCost).toBeCloseTo(
			inputCost.plus(outputCost).plus(cachedInputCost).toNumber(),
			12,
		);
	},
);
