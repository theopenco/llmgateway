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
	/**
	 * Serves a session's opening turn when the classifier gives no verdict.
	 * Must be one of `models`; unset means the cheapest candidate.
	 */
	fallbackModel: z.string().optional(),
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
 * Reasoning effort tier the classifier asks for. Mapped onto the concrete
 * values a provider mapping declares when the request is prepared.
 */
export const SMART_ROUTING_EFFORTS = ["low", "medium", "high"] as const;
export type SmartRoutingEffort = (typeof SMART_ROUTING_EFFORTS)[number];

/**
 * How the work of a session moved since the verdict it is being served under.
 * `different` is a change of kind at a similar difficulty.
 */
export const SMART_ROUTING_WORK_CHANGES = [
	"same",
	"easier",
	"harder",
	"different",
	"unclear",
] as const;
export type SmartRoutingWorkChange =
	(typeof SMART_ROUTING_WORK_CHANGES)[number];

/**
 * Below this calibrated confidence the classifier's preferred model is ignored
 * and the band's cheapest candidate wins: a coin-flip preference must not push
 * the request onto a pricier model.
 */
export const SMART_ROUTING_BEST_MODEL_MIN_CONFIDENCE = 0.5;

/** How many of the classifier's model probabilities are kept on the log. */
export const SMART_ROUTING_MAX_MODEL_PROBABILITIES = 5;

/**
 * Why a configured Jev classifier was not consulted for a request, which
 * otherwise looks identical to a verdict-less cheapest pick.
 */
export const SMART_ROUTING_CLASSIFIER_SKIP_REASONS = [
	"single-candidate",
	"compliance",
	"no-credential",
] as const;
export type SmartRoutingClassifierSkipReason =
	(typeof SMART_ROUTING_CLASSIFIER_SKIP_REASONS)[number];

export interface RequestClassification {
	difficulty: SmartRoutingDifficulty;
	difficultyScore?: number;
	/** The classifier's probability for each difficulty level. */
	difficultyProbabilities?: Partial<Record<SmartRoutingDifficulty, number>>;
	task?: SmartRoutingTaskType;
	outputType?: SmartRoutingOutputType;
	bestModel?: string;
	bestModelConfidence?: number;
	/** Top candidates by the classifier's probability, highest first. */
	bestModelProbabilities?: Record<string, number>;
	effort?: SmartRoutingEffort;
	/** Only set by a recheck of an existing session choice. */
	workChange?: SmartRoutingWorkChange;
	workChangeConfidence?: number;
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

/**
 * The fields of a logged `smartRouting` decision that explain it. Loosely
 * typed so a stored log row can be passed as-is.
 */
export interface SmartRoutingDecisionSummary {
	classifier: string;
	/** Surviving candidates, cheapest first. */
	candidateModels?: string[];
	difficulty?: string;
	difficultyScore?: number;
	difficultyProbabilities?: Partial<Record<string, number>>;
	task?: string;
	outputType?: string;
	bestModel?: string;
	bestModelConfidence?: number;
	band?: string;
	selectedModel: string;
	classifierFailed?: boolean;
	classifierReused?: boolean;
	classifierSkipped?: string;
	usedFallback?: boolean;
	trigger?: string;
	effort?: string;
	effortSource?: string;
	workChange?: string;
	keptReason?: string;
	switch?: { fromModel: string; toModel: string; reason: string };
}

const CLASSIFIER_SKIP_DESCRIPTIONS: Record<
	SmartRoutingClassifierSkipReason,
	string
> = {
	"single-candidate": "only one candidate model was available",
	compliance: "the compliance policy does not allow TypeSafe",
	"no-credential": "no TypeSafe credential was available",
};

function percent(value: number): string {
	return `${Math.round(value * 100)}%`;
}

/**
 * Formats a probability map as "low 5% · medium 24% · high 71%", in the given
 * key order, or highest first without one (jsonb does not keep key order).
 */
export function formatSmartRoutingProbabilities(
	probabilities: Partial<Record<string, number>>,
	order: readonly string[] = Object.keys(probabilities).sort(
		(a, b) => (probabilities[b] ?? 0) - (probabilities[a] ?? 0),
	),
): string {
	return order
		.filter((key) => typeof probabilities[key] === "number")
		.map((key) => `${key} ${percent(probabilities[key]!)}`)
		.join(" · ");
}

/**
 * Explains a smart-routing decision as ordered, human-readable steps: the
 * verdict, the price band it mapped to, how the classifier's model preference
 * was used, and what was served. Covers the paths that serve the same model
 * every time without a fresh verdict (no classifier, skipped, failed open,
 * reused session verdict).
 */
export function describeSmartRoutingDecision(
	decision: SmartRoutingDecisionSummary,
): string[] {
	const steps: string[] = [];
	const served = `Served ${decision.selectedModel}${
		decision.effort
			? ` at ${decision.effort} effort`
			: decision.effortSource === "caller"
				? " at the caller's reasoning effort"
				: ""
	}.`;
	const fallbackServed = decision.usedFallback
		? `Served the configured fallback model, ${decision.selectedModel}.`
		: `Served the cheapest candidate, ${decision.selectedModel}.`;

	if (decision.classifier !== "jev") {
		steps.push("No classifier is configured, so the cheapest candidate wins.");
		steps.push(fallbackServed);
		return steps;
	}

	if (decision.classifierSkipped && !decision.difficulty) {
		const reason =
			CLASSIFIER_SKIP_DESCRIPTIONS[
				decision.classifierSkipped as SmartRoutingClassifierSkipReason
			] ?? decision.classifierSkipped;
		steps.push(`The classifier was not consulted: ${reason}.`);
		steps.push(fallbackServed);
		return steps;
	}

	if (!decision.difficulty) {
		steps.push(
			decision.classifierFailed
				? "The classifier failed or timed out, so routing failed open."
				: "The classifier returned no verdict.",
		);
		steps.push(fallbackServed);
		return steps;
	}

	if (decision.classifierReused) {
		steps.push(
			`Reused the verdict from an earlier turn of this session (${decision.trigger ?? "reused"}); sessions keep their model to keep the prompt cache warm.`,
		);
	}
	if (decision.workChange) {
		steps.push(
			`Recheck: the work is ${decision.workChange === "same" ? "unchanged" : decision.workChange}${
				decision.keptReason
					? `; kept the current model (${decision.keptReason})`
					: ""
			}.`,
		);
	}

	const details = [
		typeof decision.difficultyScore === "number"
			? `score ${decision.difficultyScore.toFixed(2)}`
			: undefined,
		decision.difficultyProbabilities
			? formatSmartRoutingProbabilities(
					decision.difficultyProbabilities,
					SMART_ROUTING_DIFFICULTIES,
				)
			: undefined,
	].filter(Boolean);
	steps.push(
		`Jev rated the request ${decision.difficulty} difficulty${
			details.length > 0 ? ` (${details.join("; ")})` : ""
		}${decision.task ? `, a ${decision.task} task` : ""}${
			decision.outputType ? ` expecting ${decision.outputType}` : ""
		}.`,
	);

	if (decision.band) {
		const candidates = decision.candidateModels ?? [];
		const bands = assignSmartRoutingBands(candidates.length);
		const inBand = candidates.filter(
			(_, index) => bands[index] === decision.band,
		);
		const bandModels = inBand.length > 0 ? `: ${inBand.join(", ")}` : "";
		steps.push(
			decision.band === decision.difficulty
				? `Mapped to the ${decision.band} price band${bandModels}.`
				: `No candidate sits in the ${decision.difficulty} price band, so the ${decision.band} band was used${bandModels}.`,
		);
	}

	if (decision.bestModel) {
		const confidence =
			typeof decision.bestModelConfidence === "number"
				? ` at ${percent(decision.bestModelConfidence)} confidence`
				: "";
		if (
			(decision.bestModelConfidence ?? 0) <
			SMART_ROUTING_BEST_MODEL_MIN_CONFIDENCE
		) {
			steps.push(
				`Jev preferred ${decision.bestModel}${confidence}, below the ${percent(SMART_ROUTING_BEST_MODEL_MIN_CONFIDENCE)} threshold, so the cheapest model in the band wins.`,
			);
		} else if (decision.bestModel === decision.selectedModel) {
			steps.push(`Jev preferred ${decision.bestModel}${confidence}.`);
		} else {
			steps.push(
				`Jev preferred ${decision.bestModel}${confidence}, but it is outside the band, so the cheapest model in the band wins.`,
			);
		}
	}

	if (decision.switch) {
		steps.push(
			`Switched from ${decision.switch.fromModel} to ${decision.switch.toModel} (${decision.switch.reason}).`,
		);
	}

	steps.push(served);
	return steps;
}
