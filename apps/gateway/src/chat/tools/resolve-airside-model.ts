import { findAirsideModel } from "@/lib/cached-queries.js";

import { models, providers } from "@llmgateway/models";

import type { ParseModelInputResult } from "./parse-model-input.js";
import type { ResolveModelInfoResult } from "./resolve-model-info.js";
import type {
	Model,
	ModelDefinition,
	Provider,
	ProviderModelMapping,
} from "@llmgateway/models";

export interface AirsideResolution {
	parseResult: ParseModelInputResult;
	modelInfoResult: ResolveModelInfoResult;
	/** The synthesized mapping carrying the approved filing's prices — thread
	 *  it into calculateCosts so the request is billed at the filed rates. */
	pricingMapping: ProviderModelMapping;
}

/**
 * Resolve a "provider/model" request against Airside carrier listings.
 *
 * Only consulted when the provider prefix IS a catalogue provider but the
 * model is NOT in the static catalogue — the case parseModelInput would
 * reject. An active listing with an approved price filing becomes a
 * synthetic single-mapping model definition; everything downstream (pinned
 * provider selection, capability validation, endpoint resolution, billing)
 * treats it like a catalogue model of that provider.
 *
 * Returns null when the input is not an Airside-listed model, so the caller
 * falls back to the normal (throwing) parse path.
 */
export async function resolveAirsideModel(
	modelInput: string,
): Promise<AirsideResolution | null> {
	const slash = modelInput.indexOf("/");
	if (slash <= 0) {
		return null;
	}
	const providerCandidate = modelInput.slice(0, slash);
	const modelName = modelInput.slice(slash + 1);
	if (!modelName || modelName.includes(":")) {
		// Region suffixes only exist for catalogue mappings.
		return null;
	}
	if (!providers.some((p) => p.id === providerCandidate)) {
		return null;
	}
	// A catalogue model of this provider always wins over a listing.
	const inCatalogue = models.some(
		(m) =>
			(m.id === modelName ||
				("aliases" in m &&
					(m.aliases as readonly string[] | undefined)?.includes(modelName))) &&
			m.providers.some((p) => p.providerId === providerCandidate),
	);
	if (inCatalogue) {
		return null;
	}

	const listed = await findAirsideModel(providerCandidate, modelName);
	if (!listed) {
		return null;
	}

	const mapping: ProviderModelMapping = {
		providerId: providerCandidate as Provider,
		externalId: listed.model.modelName,
		inputPrice: listed.pricing.inputPrice,
		outputPrice: listed.pricing.outputPrice,
		cachedInputPrice: listed.pricing.cachedInputPrice ?? undefined,
		requestPrice: listed.pricing.requestPrice ?? undefined,
		contextSize: listed.model.contextSize ?? undefined,
		maxOutput: listed.model.maxOutput ?? undefined,
		streaming: listed.model.streaming,
		vision: listed.model.vision,
		tools: listed.model.tools,
		jsonOutput: listed.model.jsonOutput,
		reasoning: listed.model.reasoning,
	};

	const modelInfo: ModelDefinition = {
		id: listed.model.modelName as Model,
		name: listed.model.displayName ?? listed.model.modelName,
		family: "airside",
		providers: [mapping],
	};

	return {
		parseResult: {
			requestedModel: listed.model.modelName as Model,
			requestedProvider: providerCandidate as Provider,
			customProviderName: undefined,
			requestedRegion: undefined,
		},
		modelInfoResult: {
			modelInfo,
			activeProviders: [mapping],
			allModelProviders: [mapping],
			requestedProvider: providerCandidate as Provider,
		},
		pricingMapping: mapping,
	};
}
