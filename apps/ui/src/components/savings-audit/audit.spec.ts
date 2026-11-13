import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";

import {
	isLiveMapping,
	models,
	type ModelDefinition,
} from "@llmgateway/models";

import {
	PLATFORM_FEE_RATE,
	UsageAggregator,
	detectColumns,
	formatAuditUsd,
	mappingCost,
	matchModel,
	missingRoles,
	sampleCsv,
} from "./audit";

const NOW = new Date();
const priced = (models as readonly ModelDefinition[]).find(
	(model) =>
		model.family !== "llmgateway" &&
		!model.id.includes(".") &&
		model.providers.some(
			(mapping) =>
				mapping.inputPrice !== undefined &&
				mapping.outputPrice !== undefined &&
				isLiveMapping(mapping, NOW),
		),
)!;

function cheapest(mix: {
	inputTokens: number;
	outputTokens: number;
	cachedTokens: number;
}) {
	return priced.providers
		.filter(
			(mapping) =>
				mapping.inputPrice !== undefined &&
				mapping.outputPrice !== undefined &&
				isLiveMapping(mapping, NOW),
		)
		.map((mapping) => mappingCost(mapping, mix))
		.reduce((best, cost) => (cost.lt(best) ? cost : best));
}

describe("detectColumns", () => {
	it("recognizes an OpenRouter-style activity export", () => {
		expect(
			detectColumns([
				"generation_id",
				"created_at",
				"cost_total",
				"tokens_prompt",
				"tokens_completion",
				"tokens_cached",
				"model_permaslug",
			]),
		).toEqual({
			model: "model_permaslug",
			inputTokens: "tokens_prompt",
			outputTokens: "tokens_completion",
			cachedTokens: "tokens_cached",
			cost: "cost_total",
		});
	});

	it("recognizes an OpenAI-style usage export without costs", () => {
		const mapping = detectColumns([
			"start_time",
			"Model",
			"Input Tokens",
			"output_tokens",
			"input_cached_tokens",
		]);
		expect(mapping).toEqual({
			model: "Model",
			inputTokens: "Input Tokens",
			outputTokens: "output_tokens",
			cachedTokens: "input_cached_tokens",
		});
		expect(missingRoles(mapping)).toEqual([]);
	});

	it("reports the required columns it could not find", () => {
		expect(missingRoles(detectColumns(["date", "model", "spend"]))).toEqual([
			"inputTokens",
			"outputTokens",
		]);
	});
});

describe("matchModel", () => {
	it("ignores vendor prefixes, variants and dated snapshots", () => {
		expect(matchModel(priced.id)?.id).toBe(priced.id);
		expect(matchModel(`SomeVendor/${priced.id.toUpperCase()}`)?.id).toBe(
			priced.id,
		);
		expect(matchModel(`vendor/${priced.id}:free`)?.id).toBe(priced.id);
		expect(matchModel(`${priced.id}-2025-01-31`)?.id).toBe(priced.id);
		expect(matchModel(`${priced.id}-20250131`)?.id).toBe(priced.id);
	});

	it("does not guess", () => {
		expect(matchModel("definitely-not-a-model")).toBeUndefined();
		expect(matchModel("")).toBeUndefined();
		expect(matchModel("auto")).toBeUndefined();
	});
});

describe("mappingCost", () => {
	it("bills cached input at the cached rate and never below zero input", () => {
		const mapping = {
			...priced.providers[0],
			inputPrice: "2e-6",
			cachedInputPrice: "0.5e-6",
			outputPrice: "8e-6",
		};
		expect(
			mappingCost(mapping, {
				inputTokens: 1_000_000,
				outputTokens: 500_000,
				cachedTokens: 400_000,
			}).toNumber(),
		).toBe(1.2 + 0.2 + 4);
		expect(
			mappingCost(mapping, {
				inputTokens: 100,
				outputTokens: 0,
				cachedTokens: 900,
			}).toNumber(),
		).toBe(0.00005);
	});
});

describe("UsageAggregator", () => {
	const mapping = {
		model: "model",
		inputTokens: "in",
		outputTokens: "out",
		cachedTokens: "cached",
		cost: "cost",
	};

	it("compares the file's cost with the cheapest provider plus the fee", () => {
		const aggregator = new UsageAggregator(mapping);
		aggregator.add({
			model: `vendor/${priced.id}`,
			in: "1,000,000",
			out: "200000",
			cached: "0",
			cost: "$100.00",
		});
		aggregator.add({
			model: `vendor/${priced.id}`,
			in: 1_000_000,
			out: 200_000,
			cached: 0,
			cost: 100,
		});
		aggregator.add({ model: "mystery-model", in: 5, out: 5, cost: "9.99" });
		aggregator.add({ model: "", in: 5, out: 5, cost: "1" });

		const result = aggregator.result(NOW);
		const usage = cheapest({
			inputTokens: 2_000_000,
			outputTokens: 400_000,
			cachedTokens: 0,
		});

		expect(aggregator.rowCount).toBe(3);
		expect(result.baselineSource).toBe("file");
		expect(result.comparedRows).toBe(2);
		expect(result.unmatched).toEqual(["mystery-model"]);
		// The unmatched model's cost stays out of both sides.
		expect(result.totals.baseline.toNumber()).toBe(200);
		expect(result.totals.gatewayUsage.eq(usage)).toBe(true);
		expect(result.totals.gateway.eq(usage.mul(PLATFORM_FEE_RATE.plus(1)))).toBe(
			true,
		);
		expect(
			result.totals.difference.eq(
				new Decimal(200).minus(result.totals.gateway),
			),
		).toBe(true);
		expect(result.rows[0]).toMatchObject({
			modelId: priced.id,
			rows: 2,
			inputTokens: 2_000_000,
		});
	});

	it("falls back to list prices when the file has no cost column", () => {
		const aggregator = new UsageAggregator({
			model: "model",
			inputTokens: "in",
			outputTokens: "out",
		});
		aggregator.add({ model: priced.id, in: 1000, out: 1000 });
		const result = aggregator.result(NOW);
		expect(result.baselineSource).toBe("list");
		expect(result.comparedRows).toBe(1);
		expect(result.totals.baseline.gte(result.totals.gatewayUsage)).toBe(true);
	});

	it("audits the sample export end to end", () => {
		const [header, ...lines] = sampleCsv(NOW).split("\n");
		const headers = header.split(",");
		const aggregator = new UsageAggregator(detectColumns(headers));
		for (const line of lines) {
			const cells = line.split(",");
			aggregator.add(
				Object.fromEntries(headers.map((name, index) => [name, cells[index]])),
			);
		}
		const result = aggregator.result(NOW);
		expect(lines.length).toBeGreaterThan(0);
		expect(result.unmatched).toEqual([]);
		expect(result.comparedRows).toBe(lines.length);
	});
});

describe("formatAuditUsd", () => {
	it("keeps small amounts readable", () => {
		expect(formatAuditUsd(new Decimal("1234.5"))).toBe("$1,234.50");
		expect(formatAuditUsd(new Decimal("0.0421"))).toBe("$0.0421");
		expect(formatAuditUsd(new Decimal("-3"))).toBe("-$3.00");
	});
});
