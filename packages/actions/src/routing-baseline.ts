import {
	isLiveMapping,
	models,
	type ProviderModelMapping,
} from "@llmgateway/models";
import {
	DYNAMIC_ROUTE_PREFIX,
	type DynamicRouteGraph,
	getDynamicRouteModelNodes,
	parseCustomDynamicRouteModelRef,
} from "@llmgateway/shared/dynamic-route";

import { calculateCosts } from "./costs.js";

export interface RoutingBaselineCandidate {
	modelId: string;
	providerId: string;
	region?: string | null;
}

type TokenCount = number | string | null | undefined;

/** Token counts as stored on a log row (`decimal` columns arrive as strings). */
export interface RoutingBaselineUsage {
	promptTokens?: TokenCount;
	completionTokens?: TokenCount;
	cachedTokens?: TokenCount;
	reasoningTokens?: TokenCount;
	cacheWriteTokens?: TokenCount;
}

function toTokenCount(value: TokenCount): number | null {
	if (value === null || value === undefined) {
		return null;
	}
	const count = Number(value);
	return Number.isFinite(count) ? count : null;
}

export interface RoutingBaseline {
	/** Display id `provider/model[:region]`, the same shape as `log.usedModel`. */
	model: string;
	cost: number;
}

/** Requested models whose model choice is made by the router. */
export function isRoutedRequestedModel(requestedModel: string): boolean {
	return (
		requestedModel === "auto" ||
		requestedModel === "smart" ||
		requestedModel.startsWith(DYNAMIC_ROUTE_PREFIX)
	);
}

/**
 * The cheapest active catalogue mapping for a model, optionally restricted to
 * `providerIds`. Used where the router's own per-request provider pick is not
 * known (dynamic route model nodes, backfill).
 */
export function resolveCatalogueCandidate(
	modelId: string,
	providerIds?: string[],
): RoutingBaselineCandidate | undefined {
	const modelDef = models.find((m) => m.id === modelId);
	if (!modelDef) {
		return undefined;
	}
	let best: { providerId: string; price: number } | undefined;
	for (const mapping of modelDef.providers as ProviderModelMapping[]) {
		if (!isLiveMapping(mapping)) {
			continue;
		}
		if (providerIds && !providerIds.includes(mapping.providerId)) {
			continue;
		}
		const price =
			Number(mapping.inputPrice ?? 0) + Number(mapping.outputPrice ?? 0);
		if (!best || price < best.price) {
			best = { providerId: mapping.providerId, price };
		}
	}
	return best ? { modelId, providerId: best.providerId } : undefined;
}

/**
 * Every catalogue model a dynamic route can resolve to. Custom-provider
 * targets are skipped: they have no catalogue price.
 */
export function getDynamicRouteBaselineCandidates(
	graph: DynamicRouteGraph,
): RoutingBaselineCandidate[] {
	const candidates: RoutingBaselineCandidate[] = [];
	for (const node of getDynamicRouteModelNodes(graph)) {
		if (parseCustomDynamicRouteModelRef(node.model)) {
			continue;
		}
		const candidate = resolveCatalogueCandidate(node.model, node.providers);
		if (candidate) {
			candidates.push(candidate);
		}
	}
	return candidates;
}

function formatCandidate(candidate: RoutingBaselineCandidate): string {
	const base = `${candidate.providerId}/${candidate.modelId}`;
	return candidate.region ? `${base}:${candidate.region}` : base;
}

/**
 * Prices the request's real token counts on every candidate and returns the
 * most expensive one. Never below the actual cost, so the implied saving is
 * never negative: when the served model was the priciest option, the baseline
 * is the actual request. Null when the request carried no tokens to price.
 */
export async function computeRoutingBaseline({
	candidates,
	usage,
	actualCost,
	actualModel,
	organizationId,
}: {
	candidates: RoutingBaselineCandidate[];
	usage: RoutingBaselineUsage;
	actualCost: number;
	actualModel: string;
	organizationId: string | null;
}): Promise<RoutingBaseline | null> {
	const promptTokens = toTokenCount(usage.promptTokens);
	const completionTokens = toTokenCount(usage.completionTokens);
	if (!promptTokens && !completionTokens) {
		return null;
	}
	let baseline: RoutingBaseline = { model: actualModel, cost: actualCost };
	for (const candidate of candidates) {
		const costs = await calculateCosts(
			candidate.modelId,
			candidate.providerId,
			candidate.region ?? null,
			promptTokens,
			completionTokens,
			toTokenCount(usage.cachedTokens),
			undefined,
			toTokenCount(usage.reasoningTokens),
			0,
			undefined,
			0,
			null,
			organizationId,
			undefined,
			null,
			null,
			{ cacheWriteTokens: toTokenCount(usage.cacheWriteTokens) },
		);
		if (costs.totalCost !== null && costs.totalCost > baseline.cost) {
			baseline = { model: formatCandidate(candidate), cost: costs.totalCost };
		}
	}
	return baseline;
}
