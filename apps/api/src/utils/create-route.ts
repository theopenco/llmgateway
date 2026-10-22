import { createRoute as baseCreateRoute, z } from "@hono/zod-openapi";

import type { RouteConfig } from "@hono/zod-openapi";

type RouteInput = Omit<RouteConfig, "path"> & { path: string };

// @hono/zod-openapi skips validation of a non-required body sent without a
// JSON Content-Type and hands the handler `{}`, so required fields arrive as
// undefined. Require the body whenever its schema rejects `{}`; such requests
// then fail validation with a 400.
export function requireJsonBody<R extends RouteInput>(config: R): R {
	const body = config.request?.body;
	if (!body || body.required !== undefined) {
		return config;
	}
	const schema = body.content["application/json"]?.schema;
	if (!(schema instanceof z.ZodType) || schema.safeParse({}).success) {
		return config;
	}
	return {
		...config,
		request: { ...config.request, body: { ...body, required: true } },
	};
}

export const createRoute: typeof baseCreateRoute = (config) =>
	baseCreateRoute(requireJsonBody(config));
