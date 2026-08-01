import { OpenAPIHono } from "@hono/zod-openapi";

import { transcriptions } from "./transcriptions.js";

import type { ServerTypes } from "@/vars.js";

export const transcriptionsRoute = new OpenAPIHono<ServerTypes>();

transcriptionsRoute.route("/", transcriptions);
