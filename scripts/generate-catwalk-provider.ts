/**
 * Generate the LLM Gateway provider config for charmbracelet/catwalk
 * (the provider/model catalogue consumed by Crush, https://github.com/charmbracelet/crush).
 *
 * Reads the model catalogue from packages/models and writes
 * scripts/catwalk/llmgateway.json in catwalk's provider schema
 * (see catwalk pkg/catwalk/provider.go).
 *
 * Usage:
 *   pnpm tsx scripts/generate-catwalk-provider.ts
 *
 * Filters (mirroring catwalk's OpenRouter generator):
 *   - text output models only
 *   - at least one active (non-deprecated, non-deactivated) provider mapping
 *     with tool-calling support
 *   - context window >= 20k tokens
 *
 * Model IDs are the bare gateway model IDs (no provider prefix) so Crush
 * requests get LLM Gateway's automatic provider routing and failover.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	models,
	type ModelDefinition,
	type ProviderModelMapping,
} from "../packages/models/src/models.js";

const MIN_CONTEXT_WINDOW = 20_000;
const FALLBACK_MAX_TOKENS_CAP = 32_000;

const now = new Date();

function isActive(mapping: ProviderModelMapping): boolean {
	return (
		!(mapping.deactivatedAt && now > mapping.deactivatedAt) &&
		!(mapping.deprecatedAt && now > mapping.deprecatedAt)
	);
}

function toCostPer1M(price: string | undefined): number {
	if (!price) {
		return 0;
	}
	// Prices are USD per token in e-6 notation, so the coefficient is USD per
	// million tokens already; parse and round away float noise.
	return Math.round(Number(price) * 1e6 * 1e6) / 1e6;
}

function pricingScore(mapping: ProviderModelMapping): number {
	return Number(mapping.inputPrice ?? 0) + Number(mapping.outputPrice ?? 0);
}

interface CatwalkModel {
	id: string;
	name: string;
	cost_per_1m_in: number;
	cost_per_1m_out: number;
	cost_per_1m_in_cached: number;
	cost_per_1m_out_cached: number;
	context_window: number;
	default_max_tokens: number;
	can_reason: boolean;
	reasoning_levels?: string[];
	default_reasoning_effort?: string;
	supports_attachments: boolean;
}

function toCatwalkModel(model: ModelDefinition): CatwalkModel | undefined {
	const mappings = model.providers.filter(
		(p) => isActive(p) && p.tools === true,
	);
	if (mappings.length === 0) {
		return undefined;
	}

	const contextWindow = Math.max(...mappings.map((p) => p.contextSize ?? 0));
	if (contextWindow < MIN_CONTEXT_WINDOW) {
		return undefined;
	}

	// Root pricing mirrors the gateway's /v1/models endpoint: the cheapest
	// active mapping, since that is the best price a caller can get.
	const priced = mappings.filter(
		(p) => p.inputPrice !== undefined || p.outputPrice !== undefined,
	);
	const pricingMapping = (priced.length > 0 ? priced : mappings).reduce(
		(best, p) => (pricingScore(p) < pricingScore(best) ? p : best),
	);

	const maxOutputs = mappings
		.map((p) => p.maxOutput)
		.filter((m): m is number => m !== undefined);
	const defaultMaxTokens =
		maxOutputs.length > 0
			? Math.max(...maxOutputs)
			: Math.min(Math.floor(contextWindow / 4), FALLBACK_MAX_TOKENS_CAP);

	const canReason = mappings.some((p) => p.reasoning === true);
	const reasoningLevels =
		pricingMapping.reasoningEfforts ??
		mappings.find((p) => p.reasoningEfforts)?.reasoningEfforts;

	const catwalkModel: CatwalkModel = {
		id: model.id,
		name: model.name ?? model.id,
		cost_per_1m_in: model.free ? 0 : toCostPer1M(pricingMapping.inputPrice),
		cost_per_1m_out: model.free ? 0 : toCostPer1M(pricingMapping.outputPrice),
		cost_per_1m_in_cached: model.free
			? 0
			: toCostPer1M(
					pricingMapping.cacheReadInputPrice ?? pricingMapping.cachedInputPrice,
				),
		cost_per_1m_out_cached: 0,
		context_window: contextWindow,
		default_max_tokens: defaultMaxTokens,
		can_reason: canReason,
		supports_attachments: mappings.some((p) => p.vision === true),
	};

	if (canReason && reasoningLevels && reasoningLevels.length > 0) {
		catwalkModel.reasoning_levels = reasoningLevels;
		catwalkModel.default_reasoning_effort = reasoningLevels.includes("medium")
			? "medium"
			: reasoningLevels[Math.floor(reasoningLevels.length / 2)];
	}

	return catwalkModel;
}

const catwalkModels = models
	.filter(
		(model): model is ModelDefinition =>
			// Meta-models of the gateway itself (auto router, custom passthrough)
			// have no static pricing/context metadata to publish.
			model.family !== "llmgateway" &&
			(!model.output || model.output.includes("text")),
	)
	.map((model) => toCatwalkModel(model))
	.filter((model): model is CatwalkModel => model !== undefined)
	.sort((a, b) => a.name.localeCompare(b.name));

const provider = {
	name: "LLM Gateway",
	id: "llmgateway",
	type: "openai-compat",
	api_key: "$LLMGATEWAY_API_KEY",
	api_endpoint: "https://api.llmgateway.io/v1",
	default_large_model_id: "claude-sonnet-5",
	default_small_model_id: "claude-haiku-4-5",
	models: catwalkModels,
};

for (const id of [
	provider.default_large_model_id,
	provider.default_small_model_id,
]) {
	if (!catwalkModels.some((m) => m.id === id)) {
		throw new Error(`default model "${id}" is not in the generated model list`);
	}
}

const outPath = join(
	dirname(fileURLToPath(import.meta.url)),
	"catwalk",
	"llmgateway.json",
);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(provider, null, 2)}\n`);

console.log(`Wrote ${catwalkModels.length} models to ${outPath}`);
