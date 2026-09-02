import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";

import { airsideListingToModelDefinition } from "@/chat/tools/resolve-airside-model.js";
import { listAirsideModels } from "@/lib/cached-queries.js";
import { publicErrorResponses } from "@/lib/error-schemas.js";

import { logger, toError } from "@llmgateway/logger";
import {
	models as modelsList,
	providers,
	type ProviderModelMapping,
	type ModelDefinition,
} from "@llmgateway/models";

import type { ServerTypes } from "@/vars.js";

export const modelsApi = new OpenAPIHono<ServerTypes>();

const modelSchema = z.object({
	id: z.string(),
	name: z.string(),
	display_name: z.string().openapi({
		description:
			"Human-readable model label, mirroring `name`. Anthropic-format clients such as Claude Code read this field when populating their model picker from gateway model discovery.",
	}),
	aliases: z.array(z.string()).optional(),
	created: z.number().optional(),
	description: z.string().optional(),
	family: z.string(),
	architecture: z.object({
		input_modalities: z.array(
			z.enum(["text", "image", "video", "embedding", "audio"]),
		),
		output_modalities: z.array(
			z.enum([
				"text",
				"image",
				"video",
				"embedding",
				"audio",
				"ocr",
				"transcription",
				"rerank",
			]),
		),
		tokenizer: z.string().optional(),
	}),
	top_provider: z.object({
		is_moderated: z.boolean(),
	}),
	providers: z.array(
		z.object({
			providerId: z.string(),
			externalId: z.string(),
			supportedVideoSizes: z.array(z.string()).optional(),
			supportsVideoAudio: z.boolean().optional(),
			supportsVideoWithoutAudio: z.boolean().optional(),
			pricing: z
				.object({
					prompt: z.string(),
					completion: z.string(),
					image: z.string().optional(),
					input_audio: z.string().optional(),
					input_audio_cache_read: z.string().optional(),
					output_audio: z.string().optional(),
					per_second: z.record(z.string()).optional(),
					per_image: z.record(z.string()).optional(),
					request: z.string().optional(),
					input_cache_read: z.string().optional(),
					input_cache_write: z.string().optional(),
					input_cache_write_1h: z.string().optional(),
					ocr_page: z.string().optional(),
					input_audio_hour: z.string().optional(),
				})
				.optional(),
			streaming: z.union([z.boolean(), z.literal("only")]),
			vision: z.boolean(),
			realtime: z.boolean().optional().openapi({
				description:
					"Whether this mapping is served via the /v1/realtime WebSocket endpoint instead of /v1/chat/completions.",
			}),
			cancellation: z.boolean(),
			tools: z.boolean(),
			parallelToolCalls: z.boolean(),
			reasoning: z.boolean(),
			reasoning_efforts: z
				.array(
					z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]),
				)
				.optional()
				.openapi({
					description:
						"Exact reasoning_effort values this provider mapping accepts, in ascending order of effort. Omitted when the supported values are not declared for the mapping.",
				}),
			min_cacheable_tokens: z.number().optional().openapi({
				description:
					"Minimum prompt length (in tokens) the provider requires before a prompt-cache write can occur. cache_control markers on shorter prompts are accepted but silently not cached by the provider.",
			}),
			max_output: z.number().optional().openapi({
				description:
					"Maximum output tokens this provider mapping accepts as max_tokens; larger requests are rejected with HTTP 400. Omitted when the mapping declares no limit (any max_tokens is accepted).",
			}),
			stability: z
				.enum(["stable", "beta", "unstable", "experimental"])
				.optional(),
		}),
	),
	pricing: z.object({
		prompt: z.string(),
		completion: z.string(),
		image: z.string().optional(),
		input_audio: z.string().optional(),
		input_audio_cache_read: z.string().optional(),
		output_audio: z.string().optional(),
		per_second: z.record(z.string()).optional(),
		per_image: z.record(z.string()).optional(),
		request: z.string().optional(),
		input_cache_read: z.string().optional(),
		input_cache_write: z.string().optional(),
		input_cache_write_1h: z.string().optional(),
		web_search: z.string().optional(),
		internal_reasoning: z.string().optional(),
		ocr_page: z.string().optional(),
		input_audio_hour: z.string().optional(),
	}),
	context_length: z.number().optional(),
	max_output: z.number().optional().openapi({
		description:
			"Largest max_tokens value guaranteed to be accepted regardless of which provider mapping serves the request (the minimum across still-servable mappings that declare a limit; deactivated mappings are excluded). Omitted when no such mapping declares one.",
	}),
	per_request_limits: z.record(z.string()).optional(),
	supported_parameters: z.array(z.string()).optional(),
	json_output: z.boolean(),
	structured_outputs: z.boolean(),
	free: z.boolean().optional(),
	deprecated_at: z.string().optional(),
	deactivated_at: z.string().optional(),
	stability: z.enum(["stable", "beta", "unstable", "experimental"]).optional(),
});

const listModelsResponseSchema = z.object({
	data: z.array(modelSchema),
});

const listModels = createRoute({
	operationId: "v1_models",
	summary: "Models",
	description: "List all available models",
	method: "get",
	path: "/",
	request: {
		query: z.object({
			include_deactivated: z
				.string()
				.optional()
				.transform((val) => val === "true")
				.describe("Include deactivated models in the response")
				.openapi({ example: "false" }),
			exclude_deprecated: z
				.string()
				.optional()
				.transform((val) => val === "true")
				.describe("Exclude deprecated models from the response")
				.openapi({ example: "false" }),
			no_training: z
				.string()
				.optional()
				.transform((val) => val === "true")
				.describe(
					"Only return models and provider mappings whose provider does not train on API data",
				)
				.openapi({ example: "false" }),
			mapped: z
				.string()
				.optional()
				.transform((val) => val === "true")
				.describe(
					"Return one entry per provider mapping with `provider/model-id` ids (the gateway's provider-pinned request format) instead of one aggregated entry per model. Each entry carries that specific mapping's pricing, context length, and capabilities.",
				)
				.openapi({ example: "false" }),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: listModelsResponseSchema,
				},
			},
			description: "List of available models",
		},
		...publicErrorResponses(),
	},
});

modelsApi.openapi(listModels, async (c): Promise<any> => {
	try {
		const query = c.req.valid("query");
		const includeDeactivated = query.include_deactivated || false;
		const excludeDeprecated = query.exclude_deprecated || false;
		const noTraining = query.no_training || false;
		const mapped = query.mapped || false;
		const currentDate = new Date();

		// Set of provider ids that do not train on API data
		const noTrainingProviderIds = new Set(
			providers
				.filter((p) => p.dataPolicy?.apiTraining === false)
				.map((p) => p.id),
		);

		// Approved Airside listings join the catalogue dynamically, merged by
		// model id so a listing never duplicates a static entry. An ACTIVE
		// static mapping for the same provider wins (mirroring the routing
		// rule); with only deactivated static mappings, the Airside mapping is
		// appended to the existing model — the catalogue → DB migration case.
		const airsideDefinitions = (await listAirsideModels()).map(
			(listed) => airsideListingToModelDefinition(listed).modelInfo,
		);
		const allCatalogueModels: ModelDefinition[] = [...modelsList];
		const modelIndexById = new Map<string, number>();
		allCatalogueModels.forEach((model, index) => {
			modelIndexById.set(model.id, index);
			if ("aliases" in model) {
				for (const alias of (model.aliases as readonly string[] | undefined) ??
					[]) {
					modelIndexById.set(alias, index);
				}
			}
		});
		for (const airsideModel of airsideDefinitions) {
			const existingIndex = modelIndexById.get(airsideModel.id);
			if (existingIndex === undefined) {
				modelIndexById.set(airsideModel.id, allCatalogueModels.length);
				allCatalogueModels.push(airsideModel);
				continue;
			}
			const existing = allCatalogueModels[existingIndex];
			const airsideMapping = airsideModel.providers[0];
			const staticHasActive = existing.providers.some((provider) => {
				if (provider.providerId !== airsideMapping.providerId) {
					return false;
				}
				const deactivatedAt =
					"deactivatedAt" in provider
						? (provider.deactivatedAt as Date | string | undefined)
						: undefined;
				return !(deactivatedAt && new Date(deactivatedAt) <= currentDate);
			});
			if (!staticHasActive) {
				allCatalogueModels[existingIndex] = {
					...existing,
					providers: [...existing.providers, airsideMapping],
				} as ModelDefinition;
			}
		}

		// Filter models based on deactivation and deprecation status of their provider mappings
		const deactivationFilteredModels = allCatalogueModels.filter(
			(model: ModelDefinition) => {
				// Check if all provider mappings are deactivated
				const allDeactivated = model.providers.every(
					(provider) =>
						(provider as ProviderModelMapping).deactivatedAt &&
						currentDate > (provider as ProviderModelMapping).deactivatedAt!,
				);

				// Filter out models where all providers are deactivated (unless explicitly included)
				if (!includeDeactivated && allDeactivated) {
					return false;
				}

				// Check if all provider mappings are deprecated
				const allDeprecated = model.providers.every(
					(provider) =>
						(provider as ProviderModelMapping).deprecatedAt &&
						currentDate > (provider as ProviderModelMapping).deprecatedAt!,
				);

				// Filter out models where all providers are deprecated if requested
				if (excludeDeprecated && allDeprecated) {
					return false;
				}

				return true;
			},
		);

		// When requested, keep only provider mappings whose provider does not
		// train on API data, and drop models left with no eligible mappings.
		const filteredModels = noTraining
			? deactivationFilteredModels
					.map((model: ModelDefinition) => ({
						...model,
						providers: model.providers.filter((provider) =>
							noTrainingProviderIds.has(provider.providerId),
						),
					}))
					.filter((model) => model.providers.length > 0)
			: deactivationFilteredModels;

		// Mapped view: one entry per provider mapping, addressed the way the
		// gateway accepts provider-pinned requests (`provider/model-id`). The
		// deactivation/deprecation filters apply per mapping here — a mapping
		// drops out on its own rather than only once the whole model flips.
		if (mapped) {
			const mappedData = filteredModels.flatMap((model: ModelDefinition) =>
				model.providers
					.filter((provider) => {
						if (
							!includeDeactivated &&
							provider.deactivatedAt &&
							currentDate > provider.deactivatedAt
						) {
							return false;
						}
						if (
							excludeDeprecated &&
							provider.deprecatedAt &&
							currentDate > provider.deprecatedAt
						) {
							return false;
						}
						return true;
					})
					.map((provider: ProviderModelMapping) => {
						const providerDef = providers.find(
							(p) => p.id === provider.providerId,
						);
						const name = `${model.name ?? model.id} (${providerDef?.name ?? provider.providerId})`;

						const inputModalities: (
							"text" | "image" | "video" | "embedding" | "audio"
						)[] = ["text"];
						if (provider.vision) {
							inputModalities.push("image");
						}
						if (provider.audio) {
							inputModalities.push("audio");
						}

						const outputModalities: (
							| "text"
							| "image"
							| "video"
							| "embedding"
							| "audio"
							| "ocr"
							| "transcription"
							| "rerank"
						)[] = model.output ?? ["text"];

						return {
							id: `${provider.providerId}/${model.id}`,
							name,
							display_name: name,
							aliases: model.aliases?.map(
								(alias) => `${provider.providerId}/${alias}`,
							),
							created: model.releasedAt
								? Math.floor(model.releasedAt.getTime() / 1000)
								: undefined,
							description: `${model.id} served by ${provider.providerId}`,
							family: model.family,
							architecture: {
								input_modalities: inputModalities,
								output_modalities: outputModalities,
								tokenizer: "GPT",
							},
							top_provider: {
								is_moderated: true,
							},
							providers: [serializeProviderMapping(provider, model)],
							pricing: {
								...buildPricingFields(
									hasPricing(provider) ? provider : undefined,
								),
								web_search: "0",
								internal_reasoning: "0",
							},
							context_length: provider.contextSize,
							max_output: provider.maxOutput,
							per_request_limits: getPerRequestLimits(model),
							supported_parameters: getSupportedParametersFromModel({
								...model,
								providers: [provider],
							}),
							json_output: provider.jsonOutput === true,
							structured_outputs: provider.jsonOutputSchema === true,
							free: model.free ?? false,
							deprecated_at: provider.deprecatedAt?.toISOString(),
							deactivated_at: provider.deactivatedAt?.toISOString(),
							stability: provider.stability ?? model.stability,
						};
					}),
			);

			return c.json({ data: mappedData });
		}

		const modelData = filteredModels.map((model: ModelDefinition) => {
			// Determine input modalities (if model supports images)
			const inputModalities: (
				"text" | "image" | "video" | "embedding" | "audio"
			)[] = ["text"];

			// Check if any provider has vision support
			if (model.providers.some((p) => p.vision)) {
				inputModalities.push("image");
			}

			// Models that accept input_audio content (including realtime models)
			if (model.providers.some((p) => p.audio)) {
				inputModalities.push("audio");
			}

			// Determine output modalities from the model definition or default to
			// text only. These mirror the model catalog 1:1 (including "ocr") so
			// third-party clients can reference the same modality taxonomy.
			const outputModalities: (
				| "text"
				| "image"
				| "video"
				| "embedding"
				| "audio"
				| "ocr"
				| "transcription"
				| "rerank"
			)[] = model.output ?? ["text"];

			// Source the model-level pricing from the cheapest provider mapping
			// that is actually serving the model (not deactivated/deprecated), so
			// the root pricing reflects the best price a caller can get.
			const pricingProvider = pickPricingProvider(model.providers, currentDate);

			return {
				id: model.id,
				name: model.name ?? model.id,
				display_name: model.name ?? model.id,
				aliases: model.aliases,
				created: model.releasedAt
					? Math.floor(model.releasedAt.getTime() / 1000)
					: undefined,
				description: `${model.id} provided by ${model.providers.map((p) => p.providerId).join(", ")}`,
				family: model.family,
				architecture: {
					input_modalities: inputModalities,
					output_modalities: outputModalities,
					tokenizer: "GPT", // TODO: Should come from model definitions when available
				},
				top_provider: {
					is_moderated: true,
				},
				providers: model.providers.map((provider: ProviderModelMapping) =>
					serializeProviderMapping(provider, model),
				),
				pricing: {
					...buildPricingFields(pricingProvider),
					web_search: "0", // Not defined in model definitions yet
					internal_reasoning: "0", // Not defined in model definitions yet
				},
				// Use context length from model definition (take the largest from all providers)
				context_length:
					Math.max(...model.providers.map((p) => p.contextSize ?? 0)) ??
					undefined,
				max_output: getModelLevelMaxOutput(model.providers, currentDate),
				per_request_limits: getPerRequestLimits(model),
				// Get supported parameters from model definitions with fallback to defaults
				supported_parameters: getSupportedParametersFromModel(model),
				// A deactivated mapping can no longer serve requests, so the
				// JSON capabilities advertised at the model level must come
				// from mappings that can actually be routed to — the same
				// deactivation filter used for pricing and max_output.
				// Deprecated mappings remain routable and keep contributing.
				json_output: (model.providers as ProviderModelMapping[])
					.filter((p) => !(p.deactivatedAt && currentDate > p.deactivatedAt))
					.some((p) => p.jsonOutput === true),
				structured_outputs: (model.providers as ProviderModelMapping[])
					.filter((p) => !(p.deactivatedAt && currentDate > p.deactivatedAt))
					.some((p) => p.jsonOutputSchema === true),
				free: model.free ?? false,
				// A model is only deprecated/deactivated once EVERY provider mapping
				// is — the same `.every()` semantics used for filtering above. Report
				// the date the model fully deprecates/deactivates (when its last
				// remaining mapping does), and only when every mapping carries a date;
				// if any mapping has none, the model never fully deprecates/deactivates.
				deprecated_at: getModelLevelDate(
					model.providers.map((p) => (p as ProviderModelMapping).deprecatedAt),
				),
				deactivated_at: getModelLevelDate(
					model.providers.map((p) => (p as ProviderModelMapping).deactivatedAt),
				),
				stability: model.stability,
			};
		});

		return c.json({ data: modelData });
	} catch (error) {
		logger.error("Error in models endpoint", toError(error));
		throw new HTTPException(500, { message: "Internal server error" });
	}
});

// Serialize a provider mapping into the public `providers` entry shape shared
// by the aggregated and mapped views.
function serializeProviderMapping(
	provider: ProviderModelMapping,
	model: ModelDefinition,
) {
	// Find the provider definition to get cancellation support
	const providerDef = providers.find((p) => p.id === provider.providerId);

	return {
		providerId: provider.providerId,
		externalId: provider.externalId,
		supportedVideoSizes: provider.supportedVideoSizes,
		supportsVideoAudio: provider.supportsVideoAudio,
		supportsVideoWithoutAudio: provider.supportsVideoWithoutAudio,
		pricing: hasPricing(provider) ? buildPricingFields(provider) : undefined,
		streaming: provider.streaming,
		vision: provider.vision ?? false,
		realtime: provider.realtime === true ? true : undefined,
		cancellation: providerDef?.cancellation ?? false,
		tools: provider.tools ?? false,
		parallelToolCalls: provider.parallelToolCalls ?? false,
		reasoning: provider.reasoning ?? false,
		reasoning_efforts: provider.reasoningEfforts,
		min_cacheable_tokens: provider.minCacheableTokens,
		max_output: provider.maxOutput,
		stability: provider.stability ?? model.stability,
	};
}

// Collapse the per-provider-mapping deprecation/deactivation dates into a single
// model-level date. A model is only considered deprecated/deactivated once every
// mapping is, so return the latest date (when the last mapping flips) and only
// when every mapping has one. If any mapping has no date, the model never fully
// flips, so return undefined.
function getModelLevelDate(dates: (Date | undefined)[]): string | undefined {
	if (dates.length === 0 || dates.some((d) => d === undefined)) {
		return undefined;
	}

	return (dates as Date[])
		.reduce((latest, d) => (d.getTime() > latest.getTime() ? d : latest))
		.toISOString();
}

// The public max_tokens bound for a model. Requests are validated against the
// maxOutput of whichever provider mapping ends up serving them, so advertise the
// minimum across mappings that declare one — the largest value guaranteed to be
// accepted regardless of routing. Mappings without a declared limit accept any
// max_tokens and therefore do not constrain the bound. Deactivated mappings can
// no longer serve requests, so they don't constrain it either; deprecated
// mappings remain routable and keep enforcing their limit, so they stay in.
function getModelLevelMaxOutput(
	mappings: ProviderModelMapping[],
	currentDate: Date,
): number | undefined {
	const limits = mappings
		.filter((p) => !(p.deactivatedAt && currentDate > p.deactivatedAt))
		.map((p) => p.maxOutput)
		.filter((limit): limit is number => limit !== undefined);
	return limits.length > 0 ? Math.min(...limits) : undefined;
}

// Whether a provider mapping carries any pricing information at all.
function hasPricing(p: ProviderModelMapping): boolean {
	return (
		p.inputPrice !== undefined ||
		p.outputPrice !== undefined ||
		p.imageInputPrice !== undefined ||
		p.perSecondPrice !== undefined ||
		p.perImagePrice !== undefined ||
		p.ocrPagePrice !== undefined ||
		p.inputAudioHourPrice !== undefined
	);
}

// Build the public pricing object for a provider mapping. Used both for the
// per-provider pricing and (with a representative mapping) the model-level
// pricing, so the two expose the same level of detail. A missing mapping or
// missing field defaults to "0".
function buildPricingFields(p: ProviderModelMapping | undefined) {
	return {
		prompt: p?.inputPrice?.toString() ?? "0",
		completion: p?.outputPrice?.toString() ?? "0",
		image: p?.imageInputPrice?.toString() ?? "0",
		input_audio: p?.inputAudioPrice?.toString(),
		input_audio_cache_read: p?.cachedInputAudioPrice?.toString(),
		output_audio: p?.outputAudioPrice?.toString(),
		per_second: p?.perSecondPrice
			? Object.fromEntries(
					Object.entries(p.perSecondPrice).map(([resolution, price]) => [
						resolution,
						price.toString(),
					]),
				)
			: undefined,
		per_image: p?.perImagePrice
			? Object.fromEntries(
					Object.entries(p.perImagePrice).map(([resolution, price]) => [
						resolution,
						price.toString(),
					]),
				)
			: undefined,
		request: p?.requestPrice?.toString() ?? "0",
		input_cache_read: p?.cachedInputPrice?.toString() ?? "0",
		input_cache_write: p?.cacheWriteInputPrice?.toString() ?? "0",
		input_cache_write_1h: p?.cacheWriteInputPrice1h?.toString() ?? "0",
		ocr_page: p?.ocrPagePrice?.toString(),
		input_audio_hour: p?.inputAudioHourPrice?.toString(),
	};
}

// A single comparable cost for a provider mapping, used to pick the cheapest
// one. Token-priced models compare on input + output price; models priced by
// other units (OCR per page, video per second, per request, image) fall back to
// those. Lower is cheaper; a mapping with no comparable price sorts last.
function pricingScore(p: ProviderModelMapping): number {
	const input = p.inputPrice !== undefined ? Number(p.inputPrice) : undefined;
	const output =
		p.outputPrice !== undefined ? Number(p.outputPrice) : undefined;
	const tokenScore =
		input !== undefined || output !== undefined
			? (input ?? 0) + (output ?? 0)
			: undefined;
	// Only a positive token price is authoritative: per-unit-priced mappings
	// (image, video, OCR, request) declare token prices as "0", so a zero
	// token score must fall through to the per-unit branches below.
	if (tokenScore !== undefined && tokenScore > 0) {
		return tokenScore;
	}
	if (p.ocrPagePrice !== undefined) {
		return Number(p.ocrPagePrice);
	}
	if (p.inputAudioHourPrice !== undefined) {
		return Number(p.inputAudioHourPrice);
	}
	if (p.perSecondPrice) {
		const values = Object.values(p.perSecondPrice).map(Number);
		return values.length > 0 ? Math.min(...values) : Infinity;
	}
	if (p.perImagePrice) {
		const values = Object.values(p.perImagePrice).map(Number);
		return values.length > 0 ? Math.min(...values) : Infinity;
	}
	if (p.requestPrice !== undefined) {
		return Number(p.requestPrice);
	}
	if (p.imageInputPrice !== undefined) {
		return Number(p.imageInputPrice);
	}
	return tokenScore ?? Infinity;
}

// Pick the provider mapping that represents the model-level pricing: the
// cheapest mapping that is neither deactivated nor deprecated as of
// `currentDate`, so the reported pricing reflects the best price a caller can
// actually get. Only fall back to deactivated/deprecated mappings when no
// active mapping has pricing. Ties keep the earlier mapping in definition order.
function pickPricingProvider(
	providerMappings: ProviderModelMapping[],
	currentDate: Date,
): ProviderModelMapping | undefined {
	const isActive = (p: ProviderModelMapping) =>
		!(p.deactivatedAt && currentDate > p.deactivatedAt) &&
		!(p.deprecatedAt && currentDate > p.deprecatedAt);

	const cheapest = (candidates: ProviderModelMapping[]) =>
		candidates.reduce<ProviderModelMapping | undefined>(
			(best, p) =>
				best === undefined || pricingScore(p) < pricingScore(best) ? p : best,
			undefined,
		);

	const active = providerMappings.filter((p) => isActive(p) && hasPricing(p));
	if (active.length > 0) {
		return cheapest(active);
	}

	return cheapest(providerMappings.filter((p) => hasPricing(p)));
}

function getPerRequestLimits(
	model: ModelDefinition,
): Record<string, string> | undefined {
	const limits: Record<string, string> = {};

	if (model.maxVideoDurationSeconds !== undefined) {
		limits.max_video_duration_seconds =
			model.maxVideoDurationSeconds.toString();
	}

	return Object.keys(limits).length > 0 ? limits : undefined;
}

// Helper function to determine supported parameters from model definitions
// Falls back to common default parameters if not explicitly defined
function getSupportedParametersFromModel(model: ModelDefinition): string[] {
	// Start with explicit supported parameters if any provider defines them
	for (const provider of model.providers) {
		const supportedParameters = provider.supportedParameters;
		if (supportedParameters && supportedParameters.length > 0) {
			const params = [...supportedParameters];
			// If any provider supports reasoning, expose the reasoning parameter
			if (model.providers.some((p) => p?.reasoning)) {
				if (!params.includes("reasoning")) {
					params.push("reasoning");
				}
			}
			return params;
		}
	}

	// Check if model is in the Anthropic family (which doesn't support frequency/presence penalty)
	const isAnthropicModel = model.family === "anthropic";

	// Default common parameters that most models support
	// Note: frequency_penalty and presence_penalty are NOT supported by Anthropic's Messages API
	const defaultCommonParams = isAnthropicModel
		? [
				"temperature",
				"max_tokens",
				"top_p",
				"response_format",
				"tools",
				"tool_choice",
			]
		: [
				"temperature",
				"max_tokens",
				"top_p",
				"frequency_penalty",
				"presence_penalty",
				"response_format",
				"tools",
				"tool_choice",
			];

	// If no provider has explicit supported parameters, return defaults
	const params = [...defaultCommonParams];
	if (model.providers.some((p) => p?.reasoning)) {
		params.push("reasoning");
	}
	return params;
}
