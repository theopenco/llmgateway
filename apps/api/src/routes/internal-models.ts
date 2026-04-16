import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import { findArenaMatch, getArenaBenchmarks } from "@/lib/arena-benchmarks.js";

import {
	and,
	db,
	eq,
	gte,
	isNull,
	modelProviderMappingHistory,
	or,
	sql,
	tables,
} from "@llmgateway/db";
import {
	models as modelDefinitions,
	type ProviderModelMapping,
} from "@llmgateway/models";

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
	status: z.enum(["active", "inactive"]),
});

// Model provider mapping schema
const modelProviderMappingSchema = z.object({
	id: z.string(),
	createdAt: z.coerce.date(),
	modelId: z.string(),
	providerId: z.string(),
	modelName: z.string(),
	region: z.string().nullable(),
	inputPrice: z.string().nullable(),
	outputPrice: z.string().nullable(),
	cachedInputPrice: z.string().nullable(),
	imageInputPrice: z.string().nullable(),
	imageOutputPrice: z.string().nullable(),
	imageInputTokensByResolution: z.record(z.number()).nullable(),
	imageOutputTokensByResolution: z.record(z.number()).nullable(),
	requestPrice: z.string().nullable(),
	contextSize: z.number().nullable(),
	maxOutput: z.number().nullable(),
	streaming: z.boolean(),
	vision: z.boolean().nullable(),
	reasoning: z.boolean().nullable(),
	reasoningOutput: z.string().nullable(),
	tools: z.boolean().nullable(),
	jsonOutput: z.boolean().nullable(),
	jsonOutputSchema: z.boolean().nullable(),
	webSearch: z.boolean().nullable(),
	webSearchPrice: z.string().nullable(),
	discount: z.string().nullable(),
	stability: z.enum(["stable", "beta", "unstable", "experimental"]).nullable(),
	supportedParameters: z.array(z.string()).nullable(),
	supportedVideoSizes: z.array(z.string()).nullable(),
	supportedVideoDurationsSeconds: z.array(z.number()).nullable(),
	supportsVideoAudio: z.boolean().nullable(),
	supportsVideoWithoutAudio: z.boolean().nullable(),
	perSecondPrice: z.record(z.string()).nullable(),
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

	const [models, globalDiscounts] = await Promise.all([
		db.query.model.findMany({
			where: {
				status: { eq: "active" },
			},
			with: {
				modelProviderMappings: {
					where: {
						status: { eq: "active" },
					},
				},
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

	// Helper to find the best global discount for a given provider+model
	const getGlobalDiscount = (
		providerId: string,
		modelId: string,
		modelName: string,
	): string | null => {
		const modelMatches = (dm: string | null) =>
			dm === modelId || dm === modelName;

		// Precedence: provider+model > provider > model
		const providerModel = globalDiscounts.find(
			(d) => d.provider === providerId && modelMatches(d.model),
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
			(d) => d.provider === null && modelMatches(d.model),
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
		mappings: model.modelProviderMappings.map((mapping) => {
			const sharedMapping: ProviderModelMapping | null =
				modelDefinitions
					.find((modelDefinition) => modelDefinition.id === model.id)
					?.providers.find(
						(provider) => provider.providerId === mapping.providerId,
					) ?? null;
			const globalDiscount = getGlobalDiscount(
				mapping.providerId,
				model.id,
				mapping.modelName,
			);
			// Global discount takes precedence over hardcoded mapping discount
			const effectiveDiscount = globalDiscount ?? mapping.discount;
			return {
				...mapping,
				discount: effectiveDiscount,
				imageOutputPrice:
					sharedMapping?.imageOutputPrice !== undefined
						? String(sharedMapping.imageOutputPrice)
						: null,
				imageInputTokensByResolution:
					sharedMapping?.imageInputTokensByResolution ?? null,
				imageOutputTokensByResolution:
					sharedMapping?.imageOutputTokensByResolution ?? null,
				supportedVideoSizes: sharedMapping?.supportedVideoSizes ?? null,
				supportedVideoDurationsSeconds:
					sharedMapping?.supportedVideoDurationsSeconds ?? null,
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

	return c.json({ providers });
});

// GET /internal/models/{modelId}/benchmarks - Per-provider performance stats
const providerBenchmarkSchema = z.object({
	providerId: z.string(),
	providerName: z.string(),
	logsCount: z.number(),
	errorsCount: z.number(),
	cachedCount: z.number(),
	avgTimeToFirstToken: z.number().nullable(),
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
			upstreamErrorsCount:
				sql<number>`COALESCE(SUM(${modelProviderMappingHistory.upstreamErrorsCount}), 0)`.as(
					"upstreamErrorsCount",
				),
			cachedCount:
				sql<number>`COALESCE(SUM(${modelProviderMappingHistory.cachedCount}), 0)`.as(
					"cachedCount",
				),
			avgTimeToFirstToken: sql<
				number | null
			>`CASE WHEN SUM(${modelProviderMappingHistory.logsCount}) - SUM(${modelProviderMappingHistory.cachedCount}) > 0 THEN SUM(${modelProviderMappingHistory.totalTimeToFirstToken})::float / (SUM(${modelProviderMappingHistory.logsCount}) - SUM(${modelProviderMappingHistory.cachedCount})) ELSE NULL END`.as(
				"avgTimeToFirstToken",
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
			),
		)
		.groupBy(modelProviderMappingHistory.providerId, tables.provider.name);

	const providers = windowed.map((m) => {
		const logsCount = Number(m.logsCount);
		const errorsCount = Number(m.errorsCount);
		const upstreamErrorsCount = Number(m.upstreamErrorsCount);
		const cachedCount = Number(m.cachedCount);
		// Uptime only counts upstream/provider-side failures against the provider —
		// client errors (4xx from user) or gateway errors aren't the provider's fault.
		const uptime =
			logsCount > 0
				? Math.round(((logsCount - upstreamErrorsCount) / logsCount) * 1000) /
					10
				: null;
		return {
			providerId: m.providerId,
			providerName: m.providerName ?? m.providerId,
			logsCount,
			errorsCount,
			cachedCount,
			avgTimeToFirstToken:
				m.avgTimeToFirstToken !== null ? Number(m.avgTimeToFirstToken) : null,
			errorRate:
				logsCount > 0 ? Math.round((errorsCount / logsCount) * 1000) / 10 : 0,
			uptime,
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
