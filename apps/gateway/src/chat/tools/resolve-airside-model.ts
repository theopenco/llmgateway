import {
	findAirsideCustomProvider,
	findAirsideModel,
	findAirsideModelsByBareName,
} from "@/lib/cached-queries.js";

import {
	models,
	providers,
	staticCatalogueMapsModel,
} from "@llmgateway/models";

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
	/** Set for custom carriers (providers that exist only as an approved
	 *  Airside registration): the OpenAI-compatible endpoint to route to.
	 *  Undefined for listings on catalogue providers, which use the
	 *  provider's normal endpoint machinery. */
	customBaseUrl?: string;
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
		// /v1/models advertises listings under their bare id, so a prefix-less
		// request resolves when no static model claims the name and exactly
		// one carrier lists it; ambiguity falls back to the (throwing) parse.
		if (modelInput.includes(":")) {
			return null;
		}
		const staticModelExists = models.some(
			(m) =>
				m.id === modelInput ||
				("aliases" in m &&
					(m.aliases as readonly string[] | undefined)?.includes(modelInput)),
		);
		if (staticModelExists) {
			return null;
		}
		const listings = await findAirsideModelsByBareName(modelInput);
		if (listings.length !== 1) {
			return null;
		}
		return await buildResolution(listings[0]);
	}
	const providerCandidate = modelInput.slice(0, slash);
	const modelName = modelInput.slice(slash + 1);
	if (!modelName || modelName.includes(":")) {
		// Region suffixes only exist for catalogue mappings.
		return null;
	}
	// Prefixes the parser treats specially can never be carriers — guard here
	// too, independent of the registration-time reserved-id check.
	if (
		providerCandidate === "dynamic" ||
		providerCandidate === "custom" ||
		providerCandidate === "auto"
	) {
		return null;
	}
	const isCatalogueProvider = providers.some((p) => p.id === providerCandidate);
	let customBaseUrl: string | undefined;
	if (!isCatalogueProvider) {
		// Not a catalogue provider: only routable when the prefix is an
		// approved custom-carrier registration.
		const carrier = await findAirsideCustomProvider(providerCandidate);
		if (!carrier) {
			return null;
		}
		customBaseUrl = carrier.baseUrl;
	} else {
		// An ACTIVE catalogue mapping of this provider always wins over a
		// listing. A deactivated one does not: deactivating the static mapping
		// hands the model over to the carrier's Airside listing — the
		// catalogue -> DB migration switch.
		if (
			staticCatalogueMapsModel(providerCandidate, modelName, {
				activeOnly: true,
			})
		) {
			return null;
		}
	}

	const listed = await findAirsideModel(providerCandidate, modelName);
	if (!listed) {
		return null;
	}
	return await buildResolution(listed, customBaseUrl);
}

/** The synthesized parse/model-info results for one resolved listing. */
async function buildResolution(
	listed: Parameters<typeof airsideListingToModelDefinition>[0] & {
		model: { providerId: string };
	},
	knownCustomBaseUrl?: string,
): Promise<AirsideResolution> {
	const providerId = listed.model.providerId;
	let customBaseUrl = knownCustomBaseUrl;
	if (
		customBaseUrl === undefined &&
		!providers.some((p) => p.id === providerId)
	) {
		const carrier = await findAirsideCustomProvider(providerId);
		customBaseUrl = carrier?.baseUrl;
	}
	const { mapping, modelInfo } = airsideListingToModelDefinition(listed);

	return {
		parseResult: {
			requestedModel: listed.model.modelName as Model,
			requestedProvider: providerId as Provider,
			customProviderName: undefined,
			requestedRegion: undefined,
		},
		modelInfoResult: {
			modelInfo,
			activeProviders: [mapping],
			allModelProviders: [mapping],
			requestedProvider: providerId as Provider,
		},
		pricingMapping: mapping,
		customBaseUrl,
	};
}

/** Build the synthetic catalogue entry a listing represents — shared by the
 *  chat resolver and the /v1/models catalogue. */
export function airsideListingToModelDefinition(listed: {
	model: {
		providerId: string;
		modelName: string;
		displayName: string | null;
		contextSize: number | null;
		maxOutput: number | null;
		streaming: boolean;
		vision: boolean;
		audio: boolean;
		tools: boolean;
		jsonOutput: boolean;
		reasoning: boolean;
		reasoningEfforts: string[] | null;
	};
	pricing: {
		inputPrice: string;
		outputPrice: string;
		cachedInputPrice: string | null;
		requestPrice: string | null;
	};
}): { mapping: ProviderModelMapping; modelInfo: ModelDefinition } {
	const mapping: ProviderModelMapping = {
		providerId: listed.model.providerId as Provider,
		externalId: listed.model.modelName,
		inputPrice: listed.pricing.inputPrice,
		outputPrice: listed.pricing.outputPrice,
		cachedInputPrice: listed.pricing.cachedInputPrice ?? undefined,
		requestPrice: listed.pricing.requestPrice ?? undefined,
		contextSize: listed.model.contextSize ?? undefined,
		maxOutput: listed.model.maxOutput ?? undefined,
		streaming: listed.model.streaming,
		vision: listed.model.vision,
		audio: listed.model.audio,
		tools: listed.model.tools,
		jsonOutput: listed.model.jsonOutput,
		reasoning: listed.model.reasoning,
		reasoningEfforts: (listed.model.reasoningEfforts ??
			undefined) as ProviderModelMapping["reasoningEfforts"],
	};
	const modelInfo: ModelDefinition = {
		id: listed.model.modelName as Model,
		name: listed.model.displayName ?? listed.model.modelName,
		family: "airside",
		providers: [mapping],
	};
	return { mapping, modelInfo };
}
