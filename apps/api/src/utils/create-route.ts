import { createRoute as baseCreateRoute, z } from "@hono/zod-openapi";

import type { RouteConfig } from "@hono/zod-openapi";

type RouteInput = Omit<RouteConfig, "path"> & { path: string };

// Same media-type match @hono/zod-openapi uses to pick the JSON validator.
const JSON_MEDIA_TYPE = /^application\/([a-z-.]+\+)?json/;

// @hono/zod-openapi 1.x rejects a body sent without a JSON Content-Type with
// a 415 on its own (0.19 skipped validation and handed the handler `{}`).
// Requiring the body whenever its schema rejects `{}` now mainly keeps the
// OpenAPI document accurate. The `{}` probe runs at module load, so body
// schemas must stay synchronous and must not throw from refine/transform.
export function requireJsonBody<R extends RouteInput>(config: R): R {
	const body = config.request?.body;
	if (!body || body.required !== undefined) {
		return config;
	}
	const rejectsEmpty = Object.entries(body.content).some(
		([mediaType, media]) =>
			JSON_MEDIA_TYPE.test(mediaType) &&
			media !== undefined &&
			"schema" in media &&
			media.schema instanceof z.ZodType &&
			!media.schema.safeParse({}).success,
	);
	if (!rejectsEmpty) {
		return config;
	}
	return {
		...config,
		request: { ...config.request, body: { ...body, required: true } },
	};
}

export const createRoute: typeof baseCreateRoute = (config) =>
	baseCreateRoute(requireJsonBody(config));
