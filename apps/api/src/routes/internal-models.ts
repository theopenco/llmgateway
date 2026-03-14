import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import { and, db, gte, isNull, or, tables } from "@llmgateway/db";

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
	inputPrice: z.string().nullable(),
	outputPrice: z.string().nullable(),
	cachedInputPrice: z.string().nullable(),
	imageInputPrice: z.string().nullable(),
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
			const globalDiscount = getGlobalDiscount(
				mapping.providerId,
				model.id,
				mapping.modelName,
			);
			// Global discount takes precedence over hardcoded mapping discount
			const effectiveDiscount = globalDiscount ?? mapping.discount;
			return { ...mapping, discount: effectiveDiscount };
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
