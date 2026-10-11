import { HTTPException } from "hono/http-exception";

import {
	findAirsideCustomProvider,
	findAirsidePairsByBareName,
} from "@/lib/cached-queries.js";

import {
	expandAllProviderRegions,
	expandProviderRegions,
	models,
	providers,
} from "@llmgateway/models";

import {
	parseModelInput,
	type ParseModelInputResult,
} from "./parse-model-input.js";
import {
	resolveModelInfo,
	type ResolveModelInfoResult,
} from "./resolve-model-info.js";

import type { AirsideListedModel, AirsidePair } from "@/lib/cached-queries.js";
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
	 *  it into calculateCosts so the request is billed at the canonical rates. */
	pricingMappings: ProviderModelMapping[];
}

/** Resolve Airside listings alongside static mappings for routing and fallback. */
export async function resolveAirsideModel(
	modelInput: string,
): Promise<AirsideResolution | null> {
	const slash = modelInput.indexOf("/");
	if (slash <= 0) {
		if (modelInput.includes(":")) {
			return null;
		}
		const staticModel = models.find(
			(m) =>
				m.id === modelInput ||
				("aliases" in m &&
					(m.aliases as readonly string[] | undefined)?.includes(modelInput)),
		);
		if (staticModel) {
			if (staticModel.id !== modelInput) {
				const exactListings = (await findAirsidePairsByBareName(modelInput))
					.listings;
				if (exactListings.length > 0) {
					return buildRoutingResolution(exactListings);
				}
			}
			const owned = await findAirsidePairsByBareName(staticModel.id);
			const listings = owned.listings;
			if (listings.length === 0 && owned.unlisted.length === 0) {
				return null;
			}
			const { modelInfo, allModelProviders, pricingMappings } =
				mergeAirsideListingsIntoModel(staticModel, listings, owned.unlisted);
			if (modelInfo.providers.length === 0) {
				throw new HTTPException(400, {
					message: `Requested model ${modelInput} not supported`,
				});
			}
			return {
				parseResult: {
					requestedModel: staticModel.id as Model,
					requestedProvider: undefined,
					customProviderName: undefined,
					requestedRegion: undefined,
				},
				modelInfoResult: {
					modelInfo,
					activeProviders: modelInfo.providers,
					allModelProviders,
					requestedProvider: undefined,
				},
				pricingMappings,
			};
		}
		const { listings } = await findAirsidePairsByBareName(modelInput);
		if (listings.length === 0) {
			return null;
		}
		return buildRoutingResolution(listings);
	}
	const providerCandidate = modelInput.slice(0, slash);
	let modelName = modelInput.slice(slash + 1);
	let requestedRegion: string | undefined;
	const colonIdx = modelName.indexOf(":");
	if (colonIdx !== -1) {
		requestedRegion = modelName.slice(colonIdx + 1);
		modelName = modelName.slice(0, colonIdx);
		if (!requestedRegion || requestedRegion.includes(":")) {
			return null;
		}
	}
	if (!modelName) {
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
	if (!isCatalogueProvider) {
		// Not a catalogue provider: only routable when the prefix is an
		// approved custom-carrier registration.
		const carrier = await findAirsideCustomProvider(providerCandidate);
		if (!carrier) {
			return null;
		}
	}
	// An active listing wins over the static catalogue mapping of the same
	// pair. That is the catalogue -> DB migration switch: a carrier imports
	// its catalogue models (which copies the catalogue's own prices into an
	// approved filing), serves from the listing, and the hardcoded mapping can
	// then be retired without a routing gap. Price changes from there still go
	// through admin-approved filings, so the handover cannot reprice traffic
	// on its own.

	let owned = await findAirsidePairsByBareName(modelName);
	if (!owned.listings.length && !owned.unlisted.length) {
		const canonical = (models as readonly ModelDefinition[]).find((model) =>
			model.aliases?.includes(modelName),
		);
		if (canonical) {
			modelName = canonical.id;
			owned = await findAirsidePairsByBareName(modelName);
		}
	}
	const listed = owned.listings.find(
		(candidate) => candidate.mapping.providerId === providerCandidate,
	);
	if (!listed) {
		if (owned.unlisted.length === 0 && owned.listings.length === 0) {
			return null;
		}
		if (owned.unlisted.some((pair) => pair.providerId === providerCandidate)) {
			throw new HTTPException(400, {
				message: `Provider ${providerCandidate} does not support model ${modelName}`,
			});
		}
		// Another provider's listing is out of service: keep its static mapping
		// out of this request's fallback candidates.
		return staticResolutionWithAirside(
			modelInput,
			owned.listings,
			owned.unlisted,
		);
	}
	if (
		requestedRegion &&
		!activeAirsideRegions(listed).some(
			(regionRow) => regionRow.region === requestedRegion,
		)
	) {
		throw new HTTPException(400, {
			message: `Region '${requestedRegion}' is not available for model ${modelName}`,
		});
	}
	return buildRoutingResolution(
		owned.listings,
		owned.unlisted,
		providerCandidate as Provider,
		requestedRegion,
	);
}

/** Add Airside siblings even when the explicitly requested pair is static. */
function staticResolutionWithAirside(
	modelInput: string,
	listings: AirsideListedModel[],
	unlisted: AirsidePair[],
): AirsideResolution {
	const parseResult = parseModelInput(modelInput);
	const resolved = resolveModelInfo(
		parseResult.requestedModel,
		parseResult.requestedProvider,
	);
	const { modelInfo, allModelProviders, pricingMappings } =
		mergeAirsideListingsIntoModel(resolved.modelInfo, listings, unlisted);
	return {
		parseResult,
		modelInfoResult: {
			...resolved,
			modelInfo,
			activeProviders: modelInfo.providers,
			allModelProviders,
		},
		pricingMappings,
	};
}

/** Resolve the endpoint for the current attempt, never the original provider. */
export async function resolveAirsideProviderBaseUrl(
	providerId: string,
): Promise<string | undefined> {
	if (providers.some((provider) => provider.id === providerId)) {
		return undefined;
	}
	const carrier = await findAirsideCustomProvider(providerId);
	if (!carrier) {
		throw new HTTPException(400, {
			message: `Provider ${providerId} is not active`,
		});
	}
	return carrier.baseUrl;
}

/** Keep every eligible mapping available even when the first attempt is pinned. */
function buildRoutingResolution(
	listings: AirsideListedModel[],
	unlisted: AirsidePair[] = [],
	requestedProvider?: Provider,
	requestedRegion?: string,
): AirsideResolution {
	const listed = listings[0];
	const base = models.find((model) => model.id === listed.model.id) ?? {
		...airsideListingToModelDefinition(listed).modelInfo,
		providers: [],
	};
	const { modelInfo, allModelProviders, pricingMappings } =
		mergeAirsideListingsIntoModel(base, listings, unlisted);
	return {
		parseResult: {
			requestedModel: listed.model.id as Model,
			requestedProvider,
			customProviderName: undefined,
			requestedRegion,
		},
		modelInfoResult: {
			modelInfo,
			activeProviders: modelInfo.providers,
			allModelProviders,
			requestedProvider,
		},
		pricingMappings,
	};
}

/** Replace the static mappings owned by approved Airside listings, and drop
 *  the ones whose listing the carrier took out of service. */
export function mergeAirsideListingsIntoModel(
	staticModel: ModelDefinition,
	listings: AirsideListedModel[],
	unlisted: AirsidePair[] = [],
): {
	modelInfo: ModelDefinition;
	allModelProviders: ProviderModelMapping[];
	pricingMappings: ProviderModelMapping[];
} {
	const listingMappings = listings.map(
		(listed) => airsideListingToModelDefinition(listed).mapping,
	);
	const pricingMappings = listingMappings.flatMap((mapping) =>
		expandProviderRegions(mapping),
	);
	const ownedProviderIds = new Set([
		...listingMappings.map((mapping) => mapping.providerId),
		...unlisted
			.filter((pair) => pair.modelId === staticModel.id)
			.map((pair) => pair.providerId),
	]);
	const allModelProviders = [
		...staticModel.providers.filter(
			(mapping) => !ownedProviderIds.has(mapping.providerId),
		),
		...listingMappings,
	];
	const now = new Date();
	const activeProviders = allModelProviders.filter(
		(mapping) => !mapping.deactivatedAt || mapping.deactivatedAt > now,
	);
	return {
		modelInfo: { ...staticModel, providers: activeProviders },
		allModelProviders,
		pricingMappings,
	};
}

function activeAirsideRegions(listed: AirsideListedModel) {
	const now = new Date();
	return (listed.regionMappings ?? []).filter(
		(row) => !row.deactivatedAt || row.deactivatedAt > now,
	);
}

/** Build the synthetic catalogue entry a listing represents — shared by the
 *  chat resolver and the /v1/models catalogue. */
export function airsideListingToModelDefinition(listed: AirsideListedModel): {
	mapping: ProviderModelMapping;
	modelInfo: ModelDefinition;
} {
	const staticModel = models.find(
		(model) =>
			model.id === listed.model.id ||
			("aliases" in model &&
				(model.aliases as readonly string[] | undefined)?.includes(
					listed.model.id,
				)),
	) as ModelDefinition | undefined;
	const staticMapping = staticModel
		? expandAllProviderRegions(staticModel.providers).find(
				(candidate) =>
					candidate.providerId === listed.mapping.providerId &&
					candidate.region === undefined,
			)
		: undefined;
	const regionRows = activeAirsideRegions(listed);
	const mapping: ProviderModelMapping = {
		...staticMapping,
		// A filing carries one flat price pair; inherited context-length tiers
		// or peak windows would override it in calculateCosts.
		pricingTiers: undefined,
		peakPricing: undefined,
		// Filed regional prices; expandProviderRegions turns these into
		// routable, billable `(providerId, region)` candidates. The canonical
		// row stays routable next to them — it is the carrier's real default
		// deployment, not a synthetic root.
		routableRoot: regionRows.length > 0 ? true : undefined,
		regions:
			regionRows.length > 0
				? regionRows.flatMap((row) =>
						row.region
							? [
									{
										id: row.region,
										inputPrice: row.inputPrice ?? undefined,
										outputPrice: row.outputPrice ?? undefined,
										cachedInputPrice: row.cachedInputPrice ?? undefined,
										requestPrice: row.requestPrice ?? undefined,
									},
								]
							: [],
					)
				: undefined,
		providerId: listed.mapping.providerId as Provider,
		externalId: listed.mapping.externalId,
		apiFormat:
			listed.mapping.apiFormat === "provider-native"
				? undefined
				: (listed.mapping.apiFormat ?? undefined),
		inputPrice: listed.mapping.inputPrice ?? undefined,
		outputPrice: listed.mapping.outputPrice ?? undefined,
		cachedInputPrice: listed.mapping.cachedInputPrice ?? undefined,
		requestPrice: listed.mapping.requestPrice ?? undefined,
		contextSize: listed.mapping.contextSize ?? undefined,
		maxOutput: listed.mapping.maxOutput ?? undefined,
		streaming: listed.mapping.streaming,
		vision: listed.mapping.vision ?? undefined,
		audio: listed.mapping.audio ?? undefined,
		tools: listed.mapping.tools ?? undefined,
		supportedToolChoices: listed.mapping.supportedToolChoices ?? undefined,
		jsonOutput: listed.mapping.jsonOutput,
		jsonOutputSchema: listed.mapping.jsonOutputSchema,
		reasoning: listed.mapping.reasoning ?? undefined,
		reasoningMaxTokens: listed.mapping.reasoningMaxTokens,
		reasoningEfforts: (listed.mapping.reasoningEfforts ??
			undefined) as ProviderModelMapping["reasoningEfforts"],
		webSearch: listed.mapping.webSearch,
		quantization: listed.mapping.quantization ?? undefined,
		// Catalogue-only fields the listing carries in its DB row; a static
		// entry still in the catalogue covers rows not synced yet.
		supportsDeveloperRole:
			listed.mapping.supportsDeveloperRole ??
			staticMapping?.supportsDeveloperRole,
		supportsAssistantPrefill:
			listed.mapping.supportsAssistantPrefill ??
			staticMapping?.supportsAssistantPrefill,
		maxTemperature:
			listed.mapping.maxTemperature ?? staticMapping?.maxTemperature,
		minCacheableTokens:
			listed.mapping.minCacheableTokens ?? staticMapping?.minCacheableTokens,
		supportedParameters:
			listed.mapping.supportedParameters ?? staticMapping?.supportedParameters,
		reasoningOutput:
			(listed.mapping.reasoningOutput as "omit" | null) ??
			staticMapping?.reasoningOutput,
		stability: listed.mapping.stability,
		webSearchPrice:
			listed.mapping.webSearchPrice ?? staticMapping?.webSearchPrice,
		webSearchForcedOnly:
			listed.mapping.webSearchForcedOnly ?? staticMapping?.webSearchForcedOnly,
		cacheWriteInputPrice:
			listed.mapping.cacheWriteInputPrice ??
			staticMapping?.cacheWriteInputPrice,
		cacheWriteInputPrice1h:
			listed.mapping.cacheWriteInputPrice1h ??
			staticMapping?.cacheWriteInputPrice1h,
		cacheReadInputPrice:
			listed.mapping.cacheReadInputPrice ?? staticMapping?.cacheReadInputPrice,
		deactivatedAt: listed.mapping.deactivatedAt ?? undefined,
	};
	const modelInfo: ModelDefinition = {
		...staticModel,
		id: listed.model.id as Model,
		name: listed.model.name,
		aliases: listed.model.aliases,
		description: listed.model.description,
		family: listed.model.family,
		releasedAt: listed.model.releasedAt,
		free: listed.model.free,
		output: listed.model.output as ModelDefinition["output"],
		imageInputRequired: listed.model.imageInputRequired,
		stability: listed.model.stability,
		providers: [mapping],
	};
	return { mapping, modelInfo };
}
