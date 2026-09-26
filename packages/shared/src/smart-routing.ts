import { Decimal } from "decimal.js";
import { z } from "zod";

import { isLiveMapping } from "@llmgateway/models";

import { DEFAULT_CACHE_PRICING_BY_ORG_KIND } from "./routing-config.js";

import type { ModelDefinition, ProviderModelMapping } from "@llmgateway/models";

/**
 * Classifier used to pick which of the configured smart-routing models serves a
 * request. `none` keeps the historical behaviour (cheapest eligible model);
 * `jev` asks TypeSafe's decision model to rate the request first. An enum so
 * further classifiers can be added without another schema migration.
 */
export const SMART_ROUTING_CLASSIFIERS = ["none", "jev"] as const;
export type SmartRoutingClassifier = (typeof SMART_ROUTING_CLASSIFIERS)[number];

export const SMART_ROUTING_MAX_MODELS = 30;

/**
 * Whether an organization may use smart routing. DevPass entitlement lives
 * entirely in its own plan columns and its routing is tuned for prompt-cache
 * reuse, so smart routing is not offered there yet. Every other organization —
 * including pay-as-you-go — can configure it.
 */
export function isSmartRoutingAvailable(
	kind: string | null | undefined,
): boolean {
	return kind !== "devpass";
}

/** The hardcoded candidate set used when an org configures nothing. */
export const DEFAULT_SMART_ROUTING_MODELS = [
	"claude-opus-4-6",
	"claude-sonnet-4-6",
	"claude-haiku-4-5",
];

export const smartRoutingConfigSchema = z.object({
	classifier: z.enum(SMART_ROUTING_CLASSIFIERS),
	models: z.array(z.string()).min(1).max(SMART_ROUTING_MAX_MODELS),
});

export type SmartRoutingConfig = z.infer<typeof smartRoutingConfigSchema>;

export type SmartRoutingDifficulty = "low" | "medium" | "high";

export const SMART_ROUTING_DIFFICULTIES: readonly SmartRoutingDifficulty[] = [
	"low",
	"medium",
	"high",
];

export const SMART_ROUTING_TASK_TYPES = [
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
export type SmartRoutingTaskType = (typeof SMART_ROUTING_TASK_TYPES)[number];

export const SMART_ROUTING_OUTPUT_TYPES = [
	"short_answer",
	"long_form",
	"code",
	"structured_data",
] as const;
export type SmartRoutingOutputType =
	(typeof SMART_ROUTING_OUTPUT_TYPES)[number];

/**
 * Below this calibrated confidence the classifier's preferred model is ignored
 * and the band's cheapest candidate wins: a coin-flip preference must not push
 * the request onto a pricier model.
 */
export const SMART_ROUTING_BEST_MODEL_MIN_CONFIDENCE = 0.5;

export interface RequestClassification {
	difficulty: SmartRoutingDifficulty;
	difficultyScore?: number;
	task?: SmartRoutingTaskType;
	outputType?: SmartRoutingOutputType;
	bestModel?: string;
	bestModelConfidence?: number;
	latencyMs?: number;
	/** USD charged for this classifier call; absent on a reused verdict. */
	cost?: number;
}

/**
 * Whether auto routing may be pointed at a model: it emits text, is not a
 * routing pseudo-model, and still has a mapping that serves requests. Retired
 * models stay in the catalogue so historical logs keep resolving, but a list
 * made of them would fail every request.
 */
export function isSmartRoutingSelectableModel(
	model: Pick<ModelDefinition, "id" | "providers"> & {
		output?: readonly string[];
	},
	now: Date = new Date(),
): boolean {
	if (model.id === "auto" || model.id === "smart" || model.id === "custom") {
		return false;
	}
	if (model.output && !model.output.includes("text")) {
		return false;
	}
	return (model.providers as ProviderModelMapping[]).some((mapping) =>
		isLiveMapping(mapping, now),
	);
}

/**
 * Blended per-token price used to rank and label a model in the smart-routing
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
export function assignSmartRoutingBands(
	sortedCount: number,
): SmartRoutingDifficulty[] {
	if (sortedCount <= 0) {
		return [];
	}
	return Array.from(
		{ length: sortedCount },
		(_, index) =>
			SMART_ROUTING_DIFFICULTIES[
				Math.min(
					SMART_ROUTING_DIFFICULTIES.length - 1,
					Math.floor((index * SMART_ROUTING_DIFFICULTIES.length) / sortedCount),
				)
			],
	);
}

export interface SmartRoutingCandidate {
	modelId: string;
	price: number;
}

export interface SmartRoutingSelection<T extends SmartRoutingCandidate> {
	candidate: T;
	band: SmartRoutingDifficulty | null;
}

/**
 * Pick which candidate serves the request: the cheapest of the difficulty band
 * the classifier assigned, overridden by the classifier's own model preference
 * when it is confident and the preferred model sits in that band. A `null`
 * classification (classifier disabled or failed) falls back to the cheapest
 * candidate overall, which is exactly the pre-classifier behaviour.
 */
export function selectSmartRoutingCandidate<T extends SmartRoutingCandidate>(
	candidates: T[],
	classification: RequestClassification | null,
): SmartRoutingSelection<T> | null {
	if (candidates.length === 0) {
		return null;
	}

	const sorted = [...candidates].sort((a, b) => a.price - b.price);
	if (!classification) {
		return { candidate: sorted[0], band: null };
	}

	const bands = assignSmartRoutingBands(sorted.length);
	// Walk down from the requested difficulty so a band that no candidate
	// occupies (short lists collapse from the top) degrades to a cheaper one
	// rather than falling back to the global cheapest.
	const targetIndex = SMART_ROUTING_DIFFICULTIES.indexOf(
		classification.difficulty,
	);
	for (let index = targetIndex; index >= 0; index--) {
		const band = SMART_ROUTING_DIFFICULTIES[index];
		const inBand = sorted.filter((_, position) => bands[position] === band);
		if (inBand.length === 0) {
			continue;
		}
		if (
			classification.bestModel &&
			(classification.bestModelConfidence ?? 0) >=
				SMART_ROUTING_BEST_MODEL_MIN_CONFIDENCE
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
