import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import { loadPublicDiscounts } from "@/lib/public-discounts.js";

import { db } from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

export const publicDiscounts = new OpenAPIHono<ServerTypes>();

const discountSchema = z.object({
	id: z.string(),
	provider: z.string().nullable(),
	model: z.string().nullable(),
	discountPercent: z.string(),
	reason: z.string().nullable(),
	expiresAt: z.date().nullable(),
	createdAt: z.date(),
});

const getModelDiscounts = createRoute({
	method: "get",
	path: "/model/{modelId}",
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
						discounts: z.array(discountSchema).openapi({}),
					}),
				},
			},
			description: "Active global discounts for the specified model",
		},
	},
});

publicDiscounts.openapi(getModelDiscounts, async (c) => {
	const { modelId } = c.req.param();

	const [getPublicDiscount, mappings] = await Promise.all([
		loadPublicDiscounts(),
		db.query.modelProviderMapping.findMany({
			where: { modelId: { eq: modelId }, status: { eq: "active" } },
		}),
	]);
	const now = new Date();
	const discounts = mappings
		.filter((mapping) => !mapping.deactivatedAt || mapping.deactivatedAt > now)
		.map((mapping) => getPublicDiscount(mapping.providerId, modelId))
		.filter((discount) => discount !== null);

	return c.json({
		discounts: Array.from(
			new Map(discounts.map((discount) => [discount.id, discount])).values(),
		),
	});
});
