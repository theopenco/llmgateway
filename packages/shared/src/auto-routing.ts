import { Decimal } from "decimal.js";
import { z } from "zod";

import { isLiveMapping } from "@llmgateway/models";

import { DEFAULT_CACHE_PRICING_BY_ORG_KIND } from "./routing-config.js";

import type { ModelDefinition, ProviderModelMapping } from "@llmgateway/models";

/**
 * Classifier used to pick which of the configured auto-routing models serves a
 * request. `none` keeps the historical behaviour (cheapest eligible model);
 * `jev` asks TypeSafe's decision model to rate the request first. An enum so
 * further classifiers can be added without another schema migration.
 */
export const AUTO_ROUTING_CLASSIFIERS = ["none", "jev"] as const;
export type AutoRoutingClassifier = (typeof AUTO_ROUTING_CLASSIFIERS)[number];

export const AUTO_ROUTING_MAX_MODELS = 30;

/** The hardcoded candidate set used when an org configures nothing. */
export const DEFAULT_AUTO_ROUTING_MODELS = [
	"claude-opus-4-6",
	"claude-sonnet-4-6",
	"claude-haiku-4-5",
];

export const autoRoutingConfigSchema = z.object({
	classifier: z.enum(AUTO_ROUTING_CLASSIFIERS),
	models: z.array(z.string()).min(1).max(AUTO_ROUTING_MAX_MODELS),
});

export type AutoRoutingConfig = z.infer<typeof autoRoutingConfigSchema>;

export type AutoRoutingDifficulty = "low" | "medium" | "high";

export const AUTO_ROUTING_DIFFICULTIES: readonly AutoRoutingDifficulty[] = [
	"low",
	"medium",
	"high",
];

export const AUTO_ROUTING_TASK_TYPES = [
	"coding",
	"math",
	"analysis",
	"writing",
	"extraction",
	"summarization",
	"translation",
	"conversation",
	"agentic",
	"other",
] as const;
export type AutoRoutingTaskType = (typeof AUTO_ROUTING_TASK_TYPES)[number];

export const AUTO_ROUTING_OUTPUT_TYPES = [
	"short_answer",
	"long_form",
	"code",
	"structured_data",
] as const;
export type AutoRoutingOutputType = (typeof AUTO_ROUTING_OUTPUT_TYPES)[number];

/**
 * Below this calibrated confidence the classifier's preferred model is ignored
 * and the band's cheapest candidate wins: a coin-flip preference must not push
 * the request onto a pricier model.
 */
export const AUTO_ROUTING_BEST_MODEL_MIN_CONFIDENCE = 0.5;

export interface AutoRoutingClassification {
	difficulty: AutoRoutingDifficulty;
	difficultyScore?: number;
	task?: AutoRoutingTaskType;
	outputType?: AutoRoutingOutputType;
	bestModel?: string;
	bestModelConfidence?: number;
	latencyMs?: number;
}

/**
 * Blended per-token price used to rank and label a model in the auto-routing
 * picker: the cheapest non-deactivated mapping, priced with the same
 * cache-aware input/output blend as `getProviderSelectionPrice`. Returns
 * `undefined` when no mapping carries a token price (free or unpriced models
 * rank first anyway, and a label would be misleading).
 */
export function getModelAveragePrice(
	modelDef: Pick<ModelDefinition, "providers">,
	cachePricing: {
		cacheHitRate: number;
		cacheOutputRatio: number;
	} = DEFAULT_CACHE_PRICING_BY_ORG_KIND.default,
): number | undefined {
	const now = new Date();
	let cheapest: Decimal | undefined;

	for (const mapping of modelDef.providers as ProviderModelMapping[]) {
		if (!isLiveMapping(mapping, now)) {
			continue;
		}
		const { inputPrice, outputPrice, cachedInputPrice } = mapping;
		if (inputPrice === undefined && outputPrice === undefined) {
			continue;
		}
		const hitRate = cachePricing.cacheHitRate;
		const effectiveInput =
			hitRate > 0 && inputPrice !== undefined && cachedInputPrice !== undefined
				? new Decimal(cachedInputPrice)
						.times(hitRate)
						.plus(new Decimal(inputPrice).times(1 - hitRate))
				: new Decimal(inputPrice ?? "0");
		const price = effectiveInput
			.plus(
				new Decimal(outputPrice ?? "0").times(cachePricing.cacheOutputRatio),
			)
			.div(2);
		if (!cheapest || price.lt(cheapest)) {
			cheapest = price;
		}
	}

	return cheapest?.toNumber();
}

/**
 * Split a price-sorted candidate list into three equally sized difficulty
 * bands. Short lists collapse from the top: n=1 → all low, n=2 → low, medium.
 */
export function assignAutoRoutingBands(
	sortedCount: number,
): AutoRoutingDifficulty[] {
	if (sortedCount <= 0) {
		return [];
	}
	return Array.from(
		{ length: sortedCount },
		(_, index) =>
			AUTO_ROUTING_DIFFICULTIES[
				Math.min(
					AUTO_ROUTING_DIFFICULTIES.length - 1,
					Math.floor((index * AUTO_ROUTING_DIFFICULTIES.length) / sortedCount),
				)
			],
	);
}

export interface AutoRoutingCandidate {
	modelId: string;
	price: number;
}

export interface AutoRoutingSelection<T extends AutoRoutingCandidate> {
	candidate: T;
	band: AutoRoutingDifficulty | null;
}

/**
 * Pick which candidate serves the request: the cheapest of the difficulty band
 * the classifier assigned, overridden by the classifier's own model preference
 * when it is confident and the preferred model sits in that band. A `null`
 * classification (classifier disabled or failed) falls back to the cheapest
 * candidate overall, which is exactly the pre-classifier behaviour.
 */
export function selectAutoRoutingCandidate<T extends AutoRoutingCandidate>(
	candidates: T[],
	classification: AutoRoutingClassification | null,
): AutoRoutingSelection<T> | null {
	if (candidates.length === 0) {
		return null;
	}

	const sorted = [...candidates].sort((a, b) => a.price - b.price);
	if (!classification) {
		return { candidate: sorted[0], band: null };
	}

	const bands = assignAutoRoutingBands(sorted.length);
	// Walk down from the requested difficulty so a band that no candidate
	// occupies (short lists collapse from the top) degrades to a cheaper one
	// rather than falling back to the global cheapest.
	const targetIndex = AUTO_ROUTING_DIFFICULTIES.indexOf(
		classification.difficulty,
	);
	for (let index = targetIndex; index >= 0; index--) {
		const band = AUTO_ROUTING_DIFFICULTIES[index];
		const inBand = sorted.filter((_, position) => bands[position] === band);
		if (inBand.length === 0) {
			continue;
		}
		if (
			classification.bestModel &&
			(classification.bestModelConfidence ?? 0) >=
				AUTO_ROUTING_BEST_MODEL_MIN_CONFIDENCE
		) {
			const preferred = inBand.find(
				(candidate) => candidate.modelId === classification.bestModel,
			);
			if (preferred) {
				return { candidate: preferred, band };
			}
		}
		return { candidate: inBand[0], band };
	}

	return { candidate: sorted[0], band: null };
}
