import {
	models,
	providers,
	type ModelDefinition,
	type ProviderDefinition,
	type ProviderModelMapping,
} from "@llmgateway/models";

// ─── Active-provider helpers ─────────────────────────────────────────────────

export function isProviderActive(
	p: ProviderModelMapping,
	now: Date = new Date(),
): boolean {
	return !p.deactivatedAt || new Date(p.deactivatedAt) > now;
}

export function getActiveProviders(
	model: ModelDefinition,
	now: Date = new Date(),
): ProviderModelMapping[] {
	return model.providers.filter((p) => isProviderActive(p, now));
}

/** Text models that have at least one active, priced provider. */
export function getTextModels(now: Date = new Date()): ModelDefinition[] {
	return (models as unknown as ModelDefinition[]).filter((m) => {
		if (m.id === "custom" || m.id === "auto") {
			return false;
		}
		if (m.output?.includes("image") || m.output?.includes("video")) {
			return false;
		}
		return getActiveProviders(m, now).length > 0;
	});
}

export function getModelById(modelId: string): ModelDefinition | undefined {
	return (models as unknown as ModelDefinition[]).find((m) => m.id === modelId);
}

export function getProviderName(providerId: string): string {
	const p = (providers as unknown as ProviderDefinition[]).find(
		(p) => p.id === providerId,
	);
	return p?.name ?? providerId;
}

/** The "official" provider mapping — the one matching the model's own family. */
export function getOfficialProvider(
	model: ModelDefinition,
): ProviderModelMapping | undefined {
	return (
		model.providers.find((p) => p.providerId === model.family) ??
		model.providers[0]
	);
}

// ─── Pricing ─────────────────────────────────────────────────────────────────

/**
 * A provider can be priced for the requested token mix only if it publishes a
 * price for every token kind that is actually being used. A model that uses
 * `0` input tokens does not need an input price, and vice versa. Returns false
 * when the provider is entirely unpriced for the requested mix.
 */
function hasUsablePricing(
	p: ProviderModelMapping,
	inputTokens: number,
	outputTokens: number,
): boolean {
	if (inputTokens > 0 && p.inputPrice === undefined) {
		return false;
	}
	if (outputTokens > 0 && p.outputPrice === undefined) {
		return false;
	}
	return p.inputPrice !== undefined || p.outputPrice !== undefined;
}

export function weightedTokenCost(
	p: ProviderModelMapping,
	inputTokens: number,
	outputTokens: number,
): number {
	const inPrice = Number(p.inputPrice ?? "0");
	const outPrice = Number(p.outputPrice ?? "0");
	const inputCost = inPrice * inputTokens;
	const outputCost = outPrice * outputTokens;
	return inputCost + outputCost;
}

/**
 * Cheapest active provider for a model, weighted by the actual token mix.
 * Providers that are unpriced for the requested mix are skipped. When every
 * provider is unpriced we fall back to the first active provider so callers
 * still have something to display.
 */
export function getCheapestProvider(
	model: ModelDefinition,
	inputTokens: number,
	outputTokens: number,
	now: Date = new Date(),
): ProviderModelMapping | undefined {
	const active = getActiveProviders(model, now);
	if (active.length === 0) {
		return undefined;
	}
	const priced = active.filter((p) =>
		hasUsablePricing(p, inputTokens, outputTokens),
	);
	if (priced.length === 0) {
		return active[0];
	}
	return priced.reduce((cheapest, current) =>
		weightedTokenCost(current, inputTokens, outputTokens) <
		weightedTokenCost(cheapest, inputTokens, outputTokens)
			? current
			: cheapest,
	);
}

export interface RowCost {
	model: ModelDefinition;
	officialMapping: ProviderModelMapping | undefined;
	cheapestMapping: ProviderModelMapping | undefined;
	officialCost: number;
	gatewayCost: number;
	/** True when neither provider publishes a usable price for this mix. */
	unpriced: boolean;
}

/**
 * Compute the official (model-family provider) cost and the cheapest-routed
 * gateway cost for a single model and token mix. This is the heart of the
 * calculator and is fully deterministic so it can be unit-tested.
 */
export function computeRowCost(
	model: ModelDefinition,
	inputTokens: number,
	outputTokens: number,
	now: Date = new Date(),
): RowCost {
	const officialMapping = getOfficialProvider(model);
	const cheapestMapping = getCheapestProvider(
		model,
		inputTokens,
		outputTokens,
		now,
	);

	const officialPriced =
		officialMapping !== undefined &&
		hasUsablePricing(officialMapping, inputTokens, outputTokens);
	const cheapestPriced =
		cheapestMapping !== undefined &&
		hasUsablePricing(cheapestMapping, inputTokens, outputTokens);

	const officialCost = officialMapping
		? weightedTokenCost(officialMapping, inputTokens, outputTokens)
		: 0;
	const gatewayCost = cheapestMapping
		? weightedTokenCost(cheapestMapping, inputTokens, outputTokens)
		: 0;

	return {
		model,
		officialMapping,
		cheapestMapping,
		officialCost,
		gatewayCost,
		unpriced: !officialPriced && !cheapestPriced,
	};
}

export function parseModelFromSelector(
	selectorValue: string,
): { modelId: string; providerId: string } | null {
	if (!selectorValue) {
		return null;
	}
	if (selectorValue.includes("/")) {
		const [providerId, modelId] = selectorValue.split("/");
		return { modelId, providerId };
	}
	return { modelId: selectorValue, providerId: "" };
}

// ─── Curated "popular" comparison set ────────────────────────────────────────

/**
 * Recognisable, high-traffic models shown by default in the tokenizer
 * comparison. IDs that no longer exist in the catalog are filtered out at
 * runtime, so this list is allowed to drift slightly without breaking.
 */
export const POPULAR_MODEL_IDS: string[] = [
	"gpt-5",
	"gpt-5-mini",
	"gpt-4o",
	"gpt-4o-mini",
	"gpt-4.1",
	"o3",
	"claude-opus-4-6",
	"claude-sonnet-4-6",
	"claude-haiku-4-5",
	"gemini-2.5-pro",
	"gemini-2.5-flash",
	"deepseek-v3.2",
	"grok-4",
	"llama-3.3-70b-instruct",
	"mistral-large-latest",
	"kimi-k2",
	"qwen-max",
];

export function getPopularModels(now: Date = new Date()): ModelDefinition[] {
	return POPULAR_MODEL_IDS.map((id) => getModelById(id)).filter(
		(m): m is ModelDefinition =>
			m !== undefined && getActiveProviders(m, now).length > 0,
	);
}

// ─── Formatting ──────────────────────────────────────────────────────────────

/** Compact USD for headline figures ($1.2K, $3.4M, $0.0042…). */
export function formatUsd(value: number): string {
	if (!Number.isFinite(value) || value === 0) {
		return "$0";
	}
	if (value >= 1_000_000) {
		return `$${(value / 1_000_000).toFixed(2)}M`;
	}
	if (value >= 10_000) {
		return `$${(value / 1_000).toFixed(1)}K`;
	}
	if (value >= 1_000) {
		return `$${(value / 1_000).toFixed(2)}K`;
	}
	if (value >= 1) {
		return `$${value.toFixed(2)}`;
	}
	if (value >= 0.01) {
		return `$${value.toFixed(4)}`;
	}
	// Sub-cent: show enough significant digits to stay meaningful.
	return `$${value.toPrecision(2)}`;
}

export function formatPricePerMillion(pricePerToken: number): string {
	return `$${(pricePerToken * 1e6).toFixed(2)}`;
}

export function formatTokenCount(tokens: number): string {
	if (tokens >= 1_000_000) {
		return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 0 : 1)}M`;
	}
	if (tokens >= 1_000) {
		return `${(tokens / 1_000).toFixed(tokens >= 10_000 ? 0 : 1)}K`;
	}
	return tokens.toLocaleString();
}

export function formatInt(n: number): string {
	return Math.round(n).toLocaleString();
}
