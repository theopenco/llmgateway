import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import { findArenaMatch, getArenaBenchmarks } from "@/lib/arena-benchmarks.js";

import {
	and,
	asc,
	avgEffectiveTtftSql,
	db,
	effectiveTtftTotals,
	eq,
	excludeRegionalMappingRows,
	gte,
	isNull,
	modelProviderMappingHistory,
	or,
	sql,
	tables,
} from "@llmgateway/db";
import {
	models as modelDefinitions,
	providers as providerDefinitions,
	type ProviderModelMapping,
} from "@llmgateway/models";
import { deriveStabilityMetrics } from "@llmgateway/shared";

import type { ServerTypes } from "@/vars.js";

export const internalModels = new OpenAPIHono<ServerTypes>();

// Provider schema
const providerSchema = z.object({
	id: z.string(),
	createdAt: z.coerce.date(),
	name: z.string().nullable(),
	description: z.string().nullable(),
	streaming: z.boolean().nullable(),
	cancellation: z.boolean().nullable(),
	color: z.string().nullable(),
	website: z.string().nullable(),
	announcement: z.string().nullable(),
	modelCardBadge: z.string().nullable(),
	// Branding uploaded by the Airside carrier that claimed this provider.
	airsideLogoUrl: z.string().nullable(),
	airsideIconUrl: z.string().nullable(),
	status: z.enum(["active", "inactive"]),
});

// Pricing tier schema
const pricingTierSchema = z.object({
	name: z.string(),
	upToTokens: z.number().nullable(),
	inputPrice: z.string(),
	outputPrice: z.string(),
	cachedInputPrice: z.string().nullable(),
	cacheReadInputPrice: z.string().nullable(),
	cacheWriteInputPrice: z.string().nullable(),
	cacheWriteInputPrice1h: z.string().nullable(),
});

const timeBasedTokenPricesSchema = z.object({
	inputPrice: z.string(),
	outputPrice: z.string(),
	cachedInputPrice: z.string().nullable(),
});

const peakPricingSchema = z.object({
	peak: timeBasedTokenPricesSchema,
	offPeak: timeBasedTokenPricesSchema,
	hoursUtc: z.array(z.tuple([z.number(), z.number()])),
	offPeakDays: z
		.object({
			daysOfWeek: z.array(z.number()),
			utcOffsetMinutes: z.number(),
			timeZoneLabel: z.string(),
		})
		.nullable(),
});

// Model provider mapping schema
const modelProviderMappingSchema = z.object({
	id: z.string(),
	createdAt: z.coerce.date(),
	modelId: z.string(),
	providerId: z.string(),
	externalId: z.string(),
	region: z.string().nullable(),
	inputPrice: z.string().nullable(),
	outputPrice: z.string().nullable(),
	cachedInputPrice: z.string().nullable(),
	cacheWriteInputPrice: z.string().nullable(),
	cacheWriteInputPrice1h: z.string().nullable(),
	imageInputPrice: z.string().nullable(),
	imageOutputPrice: z.string().nullable(),
	imageInputTokensByResolution: z.record(z.number()).nullable(),
	imageOutputTokensByResolution: z.record(z.number()).nullable(),
	inputCharacterPrice: z.string().nullable(),
	inputAudioPrice: z.string().nullable(),
	cachedInputAudioPrice: z.string().nullable(),
	outputAudioPrice: z.string().nullable(),
	requestPrice: z.string().nullable(),
	inputAudioHourPrice: z.string().nullable(),
	contextSize: z.number().nullable(),
	maxOutput: z.number().nullable(),
	quantization: z
		.enum(["int4", "int8", "fp4", "fp6", "fp8", "fp16", "bf16", "fp32"])
		.nullable(),
	streaming: z.boolean(),
	vision: z.boolean().nullable(),
	audio: z.boolean().nullable(),
	document: z.boolean().nullable(),
	reasoning: z.boolean().nullable(),
	reasoningEfforts: z
		.array(z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]))
		.nullable(),
	reasoningOutput: z.string().nullable(),
	reasoningMaxTokens: z.boolean().nullable(),
	rerank: z.boolean().nullable(),
	tools: z.boolean().nullable(),
	jsonOutput: z.boolean().nullable(),
	jsonOutputSchema: z.boolean().nullable(),
	webSearch: z.boolean().nullable(),
	webSearchPrice: z.string().nullable(),
	realtime: z.boolean().nullable(),
	supportedVoices: z.array(z.string()).nullable(),
	discount: z.string().nullable(),
	stability: z.enum(["stable", "beta", "unstable", "experimental"]).nullable(),
	supportedParameters: z.array(z.string()).nullable(),
	supportedVideoSizes: z.array(z.string()).nullable(),
	supportedVideoDurationsSeconds: z.array(z.number()).nullable(),
	supportedVideoDurationsSecondsImageToVideo: z.array(z.number()).nullable(),
	supportsVideoAudio: z.boolean().nullable(),
	supportsVideoWithoutAudio: z.boolean().nullable(),
	perSecondPrice: z.record(z.string()).nullable(),
	perImagePrice: z.record(z.string()).nullable(),
	pricingTiers: z.array(pricingTierSchema).nullable(),
	peakPricing: peakPricingSchema.nullable(),
	serviceTiers: z.array(z.string()).nullable(),
	deprecatedAt: z.coerce.date().nullable(),
	deactivatedAt: z.coerce.date().nullable(),
	status: z.enum(["active", "inactive"]),
});

// Model schema with mappings
const modelSchema = z.object({
	id: z.string(),
	createdAt: z.coerce.date(),
	releasedAt: z.coerce.date().nullable(),
	name: z.string().nullable(),
	aliases: z.array(z.string()).nullable(),
	description: z.string().nullable(),
	family: z.string(),
	free: z.boolean().nullable(),
	output: z.array(z.string()).nullable(),
	imageInputRequired: z.boolean().nullable(),
	stability: z.enum(["stable", "beta", "unstable", "experimental"]).nullable(),
	status: z.enum(["active", "inactive"]),
	mappings: z.array(modelProviderMappingSchema),
});

// GET /internal/models - Returns models with mappings sorted by createdAt desc
const getModelsRoute = createRoute({
	operationId: "internal_get_models",
	summary: "Get all models",
	description:
		"Returns all models with their provider mappings, sorted by createdAt descending",
	method: "get",
	path: "/models",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						models: z.array(modelSchema),
					}),
				},
			},
			description: "List of all models with their provider mappings",
		},
	},
});

internalModels.openapi(getModelsRoute, async (c) => {
	const now = new Date();

	const [models, activeMappings, globalDiscounts] = await Promise.all([
		db.query.model.findMany({
			where: {
				status: { eq: "active" },
			},
			orderBy: {
				createdAt: "desc",
			},
		}),
		db.query.modelProviderMapping.findMany({
			where: {
				status: { eq: "active" },
			},
			orderBy: {
				createdAt: "desc",
			},
		}),
		db
			.select({
				provider: tables.discount.provider,
				model: tables.discount.model,
				discountPercent: tables.discount.discountPercent,
			})
			.from(tables.discount)
			.where(
				and(
					isNull(tables.discount.organizationId),
					or(
						isNull(tables.discount.expiresAt),
						gte(tables.discount.expiresAt, now),
					),
				),
			),
	]);

	const mappingsByModelId = new Map<string, typeof activeMappings>();
	for (const mapping of activeMappings) {
		const existing = mappingsByModelId.get(mapping.modelId);
		if (existing) {
			existing.push(mapping);
		} else {
			mappingsByModelId.set(mapping.modelId, [mapping]);
		}
	}

	// Find the best global discount for a given provider+model. Discounts are
	// always keyed by the canonical model ID.
	const getGlobalDiscount = (
		providerId: string,
		modelId: string,
	): string | null => {
		// Precedence: provider+model > provider > model
		const providerModel = globalDiscounts.find(
			(d) => d.provider === providerId && d.model === modelId,
		);
		if (providerModel) {
			return providerModel.discountPercent;
		}

		const providerOnly = globalDiscounts.find(
			(d) => d.provider === providerId && d.model === null,
		);
		if (providerOnly) {
			return providerOnly.discountPercent;
		}

		const modelOnly = globalDiscounts.find(
			(d) => d.provider === null && d.model === modelId,
		);
		if (modelOnly) {
			return modelOnly.discountPercent;
		}

		// Fully global (null provider + null model)
		const fullyGlobal = globalDiscounts.find(
			(d) => d.provider === null && d.model === null,
		);
		if (fullyGlobal) {
			return fullyGlobal.discountPercent;
		}

		return null;
	};

	// Transform and apply effective discount
	const transformedModels = models.map((model) => ({
		...model,
		mappings: (mappingsByModelId.get(model.id) ?? []).map((mapping) => {
			const sharedMapping: ProviderModelMapping | null =
				modelDefinitions
					.find((modelDefinition) => modelDefinition.id === model.id)
					?.providers.find(
						(provider) => provider.providerId === mapping.providerId,
					) ?? null;
			return {
				...mapping,
				discount: getGlobalDiscount(mapping.providerId, model.id),
				quantization: sharedMapping?.quantization ?? null,
				// Airside-materialized mappings carry their own efforts in the DB
				// row; static rows are served from the shared definition.
				reasoningEfforts:
					mapping.source === "airside"
						? ((mapping.reasoningEfforts as
								NonNullable<typeof sharedMapping>["reasoningEfforts"] | null) ??
							null)
						: (sharedMapping?.reasoningEfforts ?? null),
				reasoningMaxTokens: sharedMapping?.reasoningMaxTokens ?? null,
				rerank: sharedMapping?.rerank ?? null,
				audio: mapping.audio ?? sharedMapping?.audio ?? null,
				document: sharedMapping?.document ?? null,
				realtime: sharedMapping?.realtime ?? null,
				supportedVoices: sharedMapping?.supportedVoices ?? null,
				imageOutputPrice:
					sharedMapping?.imageOutputPrice !== undefined
						? String(sharedMapping.imageOutputPrice)
						: null,
				imageInputTokensByResolution:
					sharedMapping?.imageInputTokensByResolution ?? null,
				imageOutputTokensByResolution:
					sharedMapping?.imageOutputTokensByResolution ?? null,
				inputCharacterPrice:
					sharedMapping?.inputCharacterPrice !== undefined
						? String(sharedMapping.inputCharacterPrice)
						: null,
				inputAudioPrice:
					sharedMapping?.inputAudioPrice !== undefined
						? String(sharedMapping.inputAudioPrice)
						: null,
				cachedInputAudioPrice:
					sharedMapping?.cachedInputAudioPrice !== undefined
						? String(sharedMapping.cachedInputAudioPrice)
						: null,
				outputAudioPrice:
					sharedMapping?.outputAudioPrice !== undefined
						? String(sharedMapping.outputAudioPrice)
						: null,
				inputAudioHourPrice:
					sharedMapping?.inputAudioHourPrice !== undefined
						? String(sharedMapping.inputAudioHourPrice)
						: null,
				supportedVideoSizes: sharedMapping?.supportedVideoSizes ?? null,
				supportedVideoDurationsSeconds:
					sharedMapping?.supportedVideoDurationsSeconds ?? null,
				supportedVideoDurationsSecondsImageToVideo:
					sharedMapping?.supportedVideoDurationsSecondsImageToVideo ?? null,
				supportsVideoAudio: sharedMapping?.supportsVideoAudio ?? null,
				supportsVideoWithoutAudio:
					sharedMapping?.supportsVideoWithoutAudio ?? null,
				perSecondPrice: sharedMapping?.perSecondPrice
					? Object.fromEntries(
							Object.entries(sharedMapping.perSecondPrice).map(
								([key, price]) => [key, price.toString()],
							),
						)
					: null,
				perImagePrice: sharedMapping?.perImagePrice
					? Object.fromEntries(
							Object.entries(sharedMapping.perImagePrice).map(
								([key, price]) => [key, price.toString()],
							),
						)
					: null,
				pricingTiers: (() => {
					const regionDef = mapping.region
						? sharedMapping?.regions?.find((r) => r.id === mapping.region)
						: null;
					const rawTiers =
						regionDef?.pricingTiers ?? sharedMapping?.pricingTiers ?? null;
					if (!rawTiers) {
						return null;
					}
					return rawTiers.map((t) => ({
						name: t.name,
						upToTokens: isFinite(t.upToTokens) ? t.upToTokens : null,
						inputPrice: String(t.inputPrice),
						outputPrice: String(t.outputPrice),
						cachedInputPrice:
							t.cachedInputPrice !== undefined
								? String(t.cachedInputPrice)
								: null,
						cacheReadInputPrice:
							t.cacheReadInputPrice !== undefined
								? String(t.cacheReadInputPrice)
								: null,
						cacheWriteInputPrice:
							t.cacheWriteInputPrice !== undefined
								? String(t.cacheWriteInputPrice)
								: null,
						cacheWriteInputPrice1h:
							t.cacheWriteInputPrice1h !== undefined
								? String(t.cacheWriteInputPrice1h)
								: null,
					}));
				})(),
				peakPricing: sharedMapping?.peakPricing
					? {
							peak: {
								inputPrice: String(sharedMapping.peakPricing.peak.inputPrice),
								outputPrice: String(sharedMapping.peakPricing.peak.outputPrice),
								cachedInputPrice:
									sharedMapping.peakPricing.peak.cachedInputPrice !== undefined
										? String(sharedMapping.peakPricing.peak.cachedInputPrice)
										: null,
							},
							offPeak: {
								inputPrice: String(
									sharedMapping.peakPricing.offPeak.inputPrice,
								),
								outputPrice: String(
									sharedMapping.peakPricing.offPeak.outputPrice,
								),
								cachedInputPrice:
									sharedMapping.peakPricing.offPeak.cachedInputPrice !==
									undefined
										? String(sharedMapping.peakPricing.offPeak.cachedInputPrice)
										: null,
							},
							hoursUtc: sharedMapping.peakPricing.hoursUtc.map(
								([start, end]) => [start, end] as [number, number],
							),
							offPeakDays: sharedMapping.peakPricing.offPeakDays
								? {
										daysOfWeek: [
											...sharedMapping.peakPricing.offPeakDays.daysOfWeek,
										],
										utcOffsetMinutes:
											sharedMapping.peakPricing.offPeakDays.utcOffsetMinutes,
										timeZoneLabel:
											sharedMapping.peakPricing.offPeakDays.timeZoneLabel,
									}
								: null,
						}
					: null,
				serviceTiers: (() => {
					const tiers = sharedMapping?.serviceTiers ?? null;
					if (!tiers || tiers.length === 0) {
						return null;
					}
					const tierRegions = sharedMapping?.serviceTierRegions;
					if (tierRegions && tierRegions.length > 0) {
						const effectiveRegion =
							mapping.region ??
							(tierRegions.includes("global") ? "global" : undefined);
						if (!effectiveRegion || !tierRegions.includes(effectiveRegion)) {
							return null;
						}
					}
					return tiers;
				})(),
			};
		}),
	}));

	return c.json({ models: transformedModels });
});

// GET /internal/providers - Returns providers sorted by createdAt desc
const getProvidersRoute = createRoute({
	operationId: "internal_get_providers",
	summary: "Get all providers",
	description: "Returns all providers, sorted by createdAt descending",
	method: "get",
	path: "/providers",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						providers: z.array(providerSchema),
					}),
				},
			},
			description: "List of all providers",
		},
	},
});

internalModels.openapi(getProvidersRoute, async (c) => {
	const providers = await db.query.provider.findMany({
		where: {
			status: { eq: "active" },
		},
		orderBy: {
			createdAt: "desc",
		},
	});
	const activeClaims = await db.query.providerClaim.findMany({
		where: { status: { eq: "active" } },
		columns: { providerId: true, logoUrl: true, iconUrl: true },
	});
	const brandingByProvider = new Map(
		activeClaims.map((claim) => [claim.providerId, claim]),
	);

	// modelCardBadge only exists in the catalogue, not the provider table
	return c.json({
		providers: providers.map((provider) => ({
			...provider,
			modelCardBadge:
				providerDefinitions.find((p) => p.id === provider.id)?.modelCardBadge ??
				null,
			airsideLogoUrl: brandingByProvider.get(provider.id)?.logoUrl ?? null,
			airsideIconUrl: brandingByProvider.get(provider.id)?.iconUrl ?? null,
		})),
	});
});

// GET /internal/models/{modelId}/benchmarks - Per-provider performance stats
const providerBenchmarkSchema = z.object({
	providerId: z.string(),
	providerName: z.string(),
	logsCount: z.number(),
	errorsCount: z.number(),
	cachedCount: z.number(),
	avgTimeToFirstToken: z.number().nullable(),
	tokensPerSecond: z.number().nullable(),
	errorRate: z.number(),
	uptime: z.number().nullable(),
	windowHours: z.number(),
});

const arenaScoreSchema = z.object({
	rank: z.number(),
	score: z.number(),
	matchedName: z.string(),
});

const arenaBenchmarkSchema = z.object({
	text: arenaScoreSchema.nullable(),
	code: arenaScoreSchema.nullable(),
	source: z.string(),
	fetchedAt: z.string(),
});

const modelBenchmarksRoute = createRoute({
	operationId: "internal_get_model_benchmarks",
	summary: "Get model benchmarks",
	description:
		"Returns per-provider performance benchmarks and Arena scores for a specific model",
	method: "get",
	path: "/models/{modelId}/benchmarks",
	request: {
		params: z.object({
			modelId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						modelId: z.string(),
						providers: z.array(providerBenchmarkSchema),
						arena: arenaBenchmarkSchema,
					}),
				},
			},
			description: "Per-provider benchmarks and Arena scores for the model",
		},
	},
});

internalModels.openapi(modelBenchmarksRoute, async (c) => {
	const { modelId } = c.req.valid("param");

	const WINDOW_HOURS = 24;
	const WINDOW_MS = WINDOW_HOURS * 60 * 60 * 1000;
	const since = new Date(Date.now() - WINDOW_MS);

	const windowed = await db
		.select({
			providerId: modelProviderMappingHistory.providerId,
			providerName: tables.provider.name,
			logsCount:
				sql<number>`COALESCE(SUM(${modelProviderMappingHistory.logsCount}), 0)`.as(
					"logsCount",
				),
			errorsCount:
				sql<number>`COALESCE(SUM(${modelProviderMappingHistory.errorsCount}), 0)`.as(
					"errorsCount",
				),
			clientErrorsCount:
				sql<number>`COALESCE(SUM(${modelProviderMappingHistory.clientErrorsCount}), 0)`.as(
					"clientErrorsCount",
				),
			upstreamErrorsCount:
				sql<number>`COALESCE(SUM(${modelProviderMappingHistory.upstreamErrorsCount}), 0)`.as(
					"upstreamErrorsCount",
				),
			cachedCount:
				sql<number>`COALESCE(SUM(${modelProviderMappingHistory.cachedCount}), 0)`.as(
					"cachedCount",
				),
			// Only streamed requests record a time-to-first-token, so the average
			// divides by the sample count rather than by the non-cached request
			// count — otherwise non-streaming traffic drags it towards zero.
			// Reasoning-token samples are preferred so thinking mappings aren't
			// measured on their (much later) first content token.
			avgTimeToFirstToken: avgEffectiveTtftSql(modelProviderMappingHistory).as(
				"avgTimeToFirstToken",
			),
			totalDuration:
				sql<number>`COALESCE(SUM(${modelProviderMappingHistory.totalDuration}), 0)`.as(
					"totalDuration",
				),
			totalOutputTokens:
				sql<number>`COALESCE(SUM(${modelProviderMappingHistory.totalOutputTokens}), 0)`.as(
					"totalOutputTokens",
				),
		})
		.from(modelProviderMappingHistory)
		.innerJoin(
			tables.provider,
			eq(modelProviderMappingHistory.providerId, tables.provider.id),
		)
		.where(
			and(
				eq(modelProviderMappingHistory.modelId, modelId),
				gte(modelProviderMappingHistory.minuteTimestamp, since),
				// Per-provider totals: the region-less root row already includes the
				// provider's regional traffic.
				excludeRegionalMappingRows(modelProviderMappingHistory),
			),
		)
		.groupBy(modelProviderMappingHistory.providerId, tables.provider.name);

	const providers = windowed.map((m) => {
		const logsCount = Number(m.logsCount);
		const { errorsCount, errorRate, uptime } = deriveStabilityMetrics(
			logsCount,
			Number(m.errorsCount),
			Number(m.clientErrorsCount),
		);
		const cachedCount = Number(m.cachedCount);
		const totalDuration = Number(m.totalDuration);
		const totalOutputTokens = Number(m.totalOutputTokens);
		// Throughput = generated (output) tokens per second of request time.
		// Prompt tokens must not be counted — they inflate the number by the
		// prompt/output ratio, which is 30-60x for coding-agent traffic.
		const tokensPerSecond =
			totalDuration > 0 && totalOutputTokens > 0
				? Math.round(totalOutputTokens / (totalDuration / 1000))
				: null;
		return {
			providerId: m.providerId,
			providerName: m.providerName ?? m.providerId,
			logsCount,
			errorsCount,
			cachedCount,
			avgTimeToFirstToken:
				m.avgTimeToFirstToken !== null ? Number(m.avgTimeToFirstToken) : null,
			tokensPerSecond,
			errorRate: errorRate !== null ? Math.round(errorRate * 10) / 10 : 0,
			uptime: uptime !== null ? Math.round(uptime * 10) / 10 : null,
			windowHours: WINDOW_HOURS,
		};
	});

	// Fetch Arena benchmarks
	const arenaBenchmarks = await getArenaBenchmarks();

	const textMatch = findArenaMatch(modelId, arenaBenchmarks.text);
	const codeMatch = findArenaMatch(modelId, arenaBenchmarks.code);

	const arena = {
		text: textMatch
			? {
					rank: textMatch.rank,
					score: textMatch.score,
					matchedName: textMatch.model,
				}
			: null,
		code: codeMatch
			? {
					rank: codeMatch.rank,
					score: codeMatch.score,
					matchedName: codeMatch.model,
				}
			: null,
		source: "https://arena.ai/leaderboard",
		fetchedAt: arenaBenchmarks.fetchedAt,
	};

	return c.json({ modelId, providers, arena });
});

// --- Public per-provider uptime/history (last 4h) ---

const uptimePointSchema = z.object({
	timestamp: z.string(),
	logsCount: z.number(),
	errorsCount: z.number(),
	clientErrorsCount: z.number(),
	gatewayErrorsCount: z.number(),
	upstreamErrorsCount: z.number(),
	cachedCount: z.number(),
	avgTtft: z.number().nullable(),
	avgDuration: z.number().nullable(),
	totalTokens: z.number(),
});

const uptimeProviderSchema = z.object({
	providerId: z.string(),
	providerName: z.string(),
	logsCount: z.number(),
	errorsCount: z.number(),
	clientErrorsCount: z.number(),
	upstreamErrorsCount: z.number(),
	uptime: z.number().nullable(),
	avgTtft: z.number().nullable(),
	// Streamed-request count behind avgTtft, so callers can gate its display on
	// its own sample size instead of logsCount.
	ttftCount: z.number(),
	avgDuration: z.number().nullable(),
	tokensPerSecond: z.number().nullable(),
	points: z.array(uptimePointSchema),
});

const modelUptimeSchema = z.object({
	modelId: z.string(),
	windowMinutes: z.number(),
	providers: z.array(uptimeProviderSchema),
});

const modelUptimeRoute = createRoute({
	operationId: "internal_get_model_uptime",
	summary: "Get model uptime",
	description:
		"Returns per-provider request volume, errors, latency, and throughput for a specific model over the last 4 hours.",
	method: "get",
	path: "/models/{modelId}/uptime",
	request: {
		params: z.object({
			modelId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: modelUptimeSchema,
				},
			},
			description: "Per-provider uptime time series for the last 4 hours.",
		},
	},
});

internalModels.openapi(modelUptimeRoute, async (c) => {
	const { modelId } = c.req.valid("param");

	const WINDOW_MINUTES = 240; // 4h
	const WINDOW_MS = WINDOW_MINUTES * 60_000;
	const since = new Date(Date.now() - WINDOW_MS);

	// Active providers serving this model — included even if they have no
	// recent traffic so the page can render an idle state for them.
	const [activeProviders, rows] = await Promise.all([
		db
			.select({
				providerId: tables.modelProviderMapping.providerId,
				providerName: tables.provider.name,
			})
			.from(tables.modelProviderMapping)
			.innerJoin(
				tables.provider,
				eq(tables.modelProviderMapping.providerId, tables.provider.id),
			)
			.where(
				and(
					eq(tables.modelProviderMapping.modelId, modelId),
					eq(tables.modelProviderMapping.status, "active"),
				),
			),
		db
			.select({
				minuteTimestamp: modelProviderMappingHistory.minuteTimestamp,
				providerId: modelProviderMappingHistory.providerId,
				providerName: tables.provider.name,
				logsCount:
					sql<number>`COALESCE(SUM(${modelProviderMappingHistory.logsCount}), 0)`.as(
						"logs_count",
					),
				errorsCount:
					sql<number>`COALESCE(SUM(${modelProviderMappingHistory.errorsCount}), 0)`.as(
						"errors_count",
					),
				clientErrorsCount:
					sql<number>`COALESCE(SUM(${modelProviderMappingHistory.clientErrorsCount}), 0)`.as(
						"client_errors_count",
					),
				gatewayErrorsCount:
					sql<number>`COALESCE(SUM(${modelProviderMappingHistory.gatewayErrorsCount}), 0)`.as(
						"gateway_errors_count",
					),
				upstreamErrorsCount:
					sql<number>`COALESCE(SUM(${modelProviderMappingHistory.upstreamErrorsCount}), 0)`.as(
						"upstream_errors_count",
					),
				cachedCount:
					sql<number>`COALESCE(SUM(${modelProviderMappingHistory.cachedCount}), 0)`.as(
						"cached_count",
					),
				totalDuration:
					sql<number>`COALESCE(SUM(${modelProviderMappingHistory.totalDuration}), 0)`.as(
						"total_duration",
					),
				totalTimeToFirstToken:
					sql<number>`COALESCE(SUM(${modelProviderMappingHistory.totalTimeToFirstToken}), 0)`.as(
						"total_ttft",
					),
				timeToFirstTokenCount:
					sql<number>`COALESCE(SUM(${modelProviderMappingHistory.timeToFirstTokenCount}), 0)`.as(
						"ttft_count",
					),
				totalTimeToFirstReasoningToken:
					sql<number>`COALESCE(SUM(${modelProviderMappingHistory.totalTimeToFirstReasoningToken}), 0)`.as(
						"total_ttfrt",
					),
				timeToFirstReasoningTokenCount:
					sql<number>`COALESCE(SUM(${modelProviderMappingHistory.timeToFirstReasoningTokenCount}), 0)`.as(
						"ttfrt_count",
					),
				totalTokens:
					sql<number>`COALESCE(SUM(${modelProviderMappingHistory.totalTokens}), 0)`.as(
						"total_tokens",
					),
				totalOutputTokens:
					sql<number>`COALESCE(SUM(${modelProviderMappingHistory.totalOutputTokens}), 0)`.as(
						"total_output_tokens",
					),
			})
			.from(modelProviderMappingHistory)
			.innerJoin(
				tables.provider,
				eq(modelProviderMappingHistory.providerId, tables.provider.id),
			)
			.where(
				and(
					eq(modelProviderMappingHistory.modelId, modelId),
					gte(modelProviderMappingHistory.minuteTimestamp, since),
					excludeRegionalMappingRows(modelProviderMappingHistory),
				),
			)
			.groupBy(
				modelProviderMappingHistory.minuteTimestamp,
				modelProviderMappingHistory.providerId,
				tables.provider.name,
			)
			.orderBy(asc(modelProviderMappingHistory.minuteTimestamp)),
	]);

	const byProvider = new Map<
		string,
		{
			providerId: string;
			providerName: string;
			points: Array<{
				timestamp: string;
				logsCount: number;
				errorsCount: number;
				clientErrorsCount: number;
				gatewayErrorsCount: number;
				upstreamErrorsCount: number;
				cachedCount: number;
				totalDuration: number;
				totalTimeToFirstToken: number;
				timeToFirstTokenCount: number;
				totalTimeToFirstReasoningToken: number;
				timeToFirstReasoningTokenCount: number;
				totalTokens: number;
				totalOutputTokens: number;
			}>;
		}
	>();

	// Seed with active providers so idle ones still render
	for (const p of activeProviders) {
		if (!byProvider.has(p.providerId)) {
			byProvider.set(p.providerId, {
				providerId: p.providerId,
				providerName: p.providerName ?? p.providerId,
				points: [],
			});
		}
	}

	for (const r of rows) {
		const key = r.providerId;
		const entry = byProvider.get(key) ?? {
			providerId: r.providerId,
			providerName: r.providerName ?? r.providerId,
			points: [],
		};
		entry.points.push({
			timestamp: r.minuteTimestamp.toISOString(),
			logsCount: Number(r.logsCount),
			errorsCount: Number(r.errorsCount),
			clientErrorsCount: Number(r.clientErrorsCount),
			gatewayErrorsCount: Number(r.gatewayErrorsCount),
			upstreamErrorsCount: Number(r.upstreamErrorsCount),
			cachedCount: Number(r.cachedCount),
			totalDuration: Number(r.totalDuration),
			totalTimeToFirstToken: Number(r.totalTimeToFirstToken),
			timeToFirstTokenCount: Number(r.timeToFirstTokenCount),
			totalTimeToFirstReasoningToken: Number(r.totalTimeToFirstReasoningToken),
			timeToFirstReasoningTokenCount: Number(r.timeToFirstReasoningTokenCount),
			totalTokens: Number(r.totalTokens),
			totalOutputTokens: Number(r.totalOutputTokens),
		});
		byProvider.set(key, entry);
	}

	const providers = Array.from(byProvider.values()).map((p) => {
		let totalLogs = 0;
		let totalErrors = 0;
		let totalClientErrors = 0;
		let totalUpstreamErrors = 0;
		let totalDuration = 0;
		let totalTtft = 0;
		let totalTtftCount = 0;
		let totalTtfrt = 0;
		let totalTtfrtCount = 0;
		let totalOutputTokens = 0;

		const points = p.points.map((pt) => {
			totalLogs += pt.logsCount;
			totalErrors += pt.errorsCount;
			totalClientErrors += pt.clientErrorsCount;
			totalUpstreamErrors += pt.upstreamErrorsCount;
			totalDuration += pt.totalDuration;
			totalTtft += pt.totalTimeToFirstToken;
			totalTtftCount += pt.timeToFirstTokenCount;
			totalTtfrt += pt.totalTimeToFirstReasoningToken;
			totalTtfrtCount += pt.timeToFirstReasoningTokenCount;
			totalOutputTokens += pt.totalOutputTokens;
			// Only streamed requests contribute a TTFT sample, so divide by the
			// sample count instead of the request count. Reasoning-token samples
			// take precedence so thinking mappings aren't measured on their
			// (much later) first content token.
			const { total: pointTtft, count: pointTtftCount } =
				effectiveTtftTotals(pt);
			const pointMetrics = deriveStabilityMetrics(
				pt.logsCount,
				pt.errorsCount,
				pt.clientErrorsCount,
			);
			return {
				timestamp: pt.timestamp,
				logsCount: pt.logsCount,
				errorsCount: pointMetrics.errorsCount,
				clientErrorsCount: pt.clientErrorsCount,
				gatewayErrorsCount: pt.gatewayErrorsCount,
				upstreamErrorsCount: pt.upstreamErrorsCount,
				cachedCount: pt.cachedCount,
				avgTtft:
					pointTtftCount > 0 ? Math.round(pointTtft / pointTtftCount) : null,
				avgDuration:
					pt.logsCount > 0 ? Math.round(pt.totalDuration / pt.logsCount) : null,
				totalTokens: pt.totalTokens,
			};
		});

		const stability = deriveStabilityMetrics(
			totalLogs,
			totalErrors,
			totalClientErrors,
		);
		const uptime =
			stability.uptime !== null ? Math.round(stability.uptime * 10) / 10 : null;
		// Output tokens only — including prompt tokens would inflate throughput
		// by the prompt/output ratio (see the benchmarks endpoint above).
		const tokensPerSecond =
			totalDuration > 0
				? Math.round(totalOutputTokens / (totalDuration / 1000))
				: null;
		const { total: providerTtft, count: providerTtftCount } =
			effectiveTtftTotals({
				totalTimeToFirstToken: totalTtft,
				timeToFirstTokenCount: totalTtftCount,
				totalTimeToFirstReasoningToken: totalTtfrt,
				timeToFirstReasoningTokenCount: totalTtfrtCount,
			});

		return {
			providerId: p.providerId,
			providerName: p.providerName,
			logsCount: totalLogs,
			errorsCount: stability.errorsCount,
			clientErrorsCount: totalClientErrors,
			upstreamErrorsCount: totalUpstreamErrors,
			uptime,
			avgTtft:
				providerTtftCount > 0
					? Math.round(providerTtft / providerTtftCount)
					: null,
			ttftCount: providerTtftCount,
			avgDuration: totalLogs > 0 ? Math.round(totalDuration / totalLogs) : null,
			tokensPerSecond,
			points,
		};
	});

	providers.sort((a, b) => b.logsCount - a.logsCount);

	return c.json({
		modelId,
		windowMinutes: WINDOW_MINUTES,
		providers,
	});
});
