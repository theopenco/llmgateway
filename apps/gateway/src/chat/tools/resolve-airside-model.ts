import {
	findAirsideCustomProvider,
	findAirsideModel,
	findAirsideModelsByBareName,
} from "@/lib/cached-queries.js";

import {
	expandAllProviderRegions,
	expandProviderRegions,
	models,
	providers,
} from "@llmgateway/models";

import type { ParseModelInputResult } from "./parse-model-input.js";
import type { ResolveModelInfoResult } from "./resolve-model-info.js";
import type { AirsideListedModel } from "@/lib/cached-queries.js";
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
		const staticModel = models.find(
			(m) =>
				m.id === modelInput ||
				("aliases" in m &&
					(m.aliases as readonly string[] | undefined)?.includes(modelInput)),
		);
		if (staticModel) {
			if (staticModel.id !== modelInput) {
				const exactListings = await findAirsideModelsByBareName(modelInput);
				if (exactListings.length === 1) {
					return await buildResolution(exactListings[0]);
				}
				if (exactListings.length > 1) {
					return null;
				}
			}
			const listings = (
				await findAirsideModelsByBareName(staticModel.id)
			).filter((listed) =>
				providers.some((provider) => provider.id === listed.mapping.providerId),
			);
			if (listings.length === 0) {
				return null;
			}
			const { modelInfo, allModelProviders, pricingMappings } =
				mergeAirsideListingsIntoModel(staticModel, listings);
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
		const listings = await findAirsideModelsByBareName(modelInput);
		if (listings.length !== 1) {
			return null;
		}
		return await buildResolution(listings[0]);
	}
	const providerCandidate = modelInput.slice(0, slash);
	let modelName = modelInput.slice(slash + 1);
	let requestedRegion: string | undefined;
	const colonIdx = modelName.indexOf(":");
	if (colonIdx !== -1) {
		// A region suffix resolves here only when the listing filed that region;
		// otherwise fall through to the static parse, which owns catalogue
		// regions.
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
	let customBaseUrl: string | undefined;
	if (!isCatalogueProvider) {
		// Not a catalogue provider: only routable when the prefix is an
		// approved custom-carrier registration.
		const carrier = await findAirsideCustomProvider(providerCandidate);
		if (!carrier) {
			return null;
		}
		customBaseUrl = carrier.baseUrl;
	}
	// An active listing wins over the static catalogue mapping of the same
	// pair. That is the catalogue -> DB migration switch: a carrier imports
	// its catalogue models (which copies the catalogue's own prices into an
	// approved filing), serves from the listing, and the hardcoded mapping can
	// then be retired without a routing gap. Price changes from there still go
	// through admin-approved filings, so the handover cannot reprice traffic
	// on its own.

	const listed = await findAirsideModel(providerCandidate, modelName);
	if (!listed) {
		return null;
	}
	if (
		requestedRegion &&
		!(listed.regionMappings ?? []).some(
			(regionRow) => regionRow.region === requestedRegion,
		)
	) {
		return null;
	}
	return await buildResolution(listed, customBaseUrl, requestedRegion);
}

/** The synthesized parse/model-info results for one resolved listing. */
async function buildResolution(
	listed: AirsideListedModel,
	knownCustomBaseUrl?: string,
	requestedRegion?: string,
): Promise<AirsideResolution> {
	const providerId = listed.mapping.providerId;
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
			requestedModel: listed.model.id as Model,
			requestedProvider: providerId as Provider,
			customProviderName: undefined,
			requestedRegion,
		},
		modelInfoResult: {
			modelInfo,
			activeProviders: [mapping],
			allModelProviders: [mapping],
			requestedProvider: providerId as Provider,
		},
		pricingMappings: expandProviderRegions(mapping),
		customBaseUrl,
	};
}

/** Replace the static mappings owned by approved Airside listings. */
export function mergeAirsideListingsIntoModel(
	staticModel: ModelDefinition,
	listings: AirsideListedModel[],
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
	const ownedProviderIds = new Set(
		listingMappings.map((mapping) => mapping.providerId),
	);
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
	const regionRows = listed.regionMappings ?? [];
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
		jsonOutput: listed.mapping.jsonOutput,
		reasoning: listed.mapping.reasoning ?? undefined,
		reasoningEfforts: (listed.mapping.reasoningEfforts ??
			undefined) as ProviderModelMapping["reasoningEfforts"],
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
