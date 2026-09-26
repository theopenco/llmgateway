import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import { getActiveSystemBanner } from "@/lib/system-banner.js";

import { SYSTEM_BANNER_SEVERITIES } from "@llmgateway/shared";

import type { ServerTypes } from "@/vars.js";

/**
 * Public, unauthenticated announcement banner rendered by the main UI,
 * DevPass, docs and Airside. Toggled from the admin dashboard.
 */
export const publicBanner = new OpenAPIHono<ServerTypes>();

const getBanner = createRoute({
	method: "get",
	path: "/",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z
						.object({
							banner: z
								.object({
									message: z.string(),
									severity: z.enum(SYSTEM_BANNER_SEVERITIES),
									linkUrl: z.string().nullable(),
									linkLabel: z.string().nullable(),
								})
								.nullable(),
						})
						.openapi({}),
				},
			},
			description:
				"The active announcement banner, or null when there is none.",
		},
	},
});

publicBanner.openapi(getBanner, async (c) => {
	// Short enough that switching the banner off reaches every site quickly,
	// long enough that it does not add a database read per page view.
	c.header("Cache-Control", "public, max-age=30");
	return c.json({ banner: await getActiveSystemBanner() });
});

export default publicBanner;
