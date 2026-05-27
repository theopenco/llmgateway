import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import { and, db, desc, eq, gte, isNull, or, tables } from "@llmgateway/db";

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

	const now = new Date();
	const notExpired = or(
		isNull(tables.discount.expiresAt),
		gte(tables.discount.expiresAt, now),
	);

	const discounts = await db
		.select()
		.from(tables.discount)
		.where(
			and(
				isNull(tables.discount.organizationId),
				or(isNull(tables.discount.model), eq(tables.discount.model, modelId)),
				notExpired,
			),
		)
		.orderBy(desc(tables.discount.createdAt));

	return c.json({
		discounts,
	});
});
