import { OpenAPIHono } from "@hono/zod-openapi";

import { decisions } from "./decisions.js";

import type { ServerTypes } from "@/vars.js";

export const decisionsRoute = new OpenAPIHono<ServerTypes>();

decisionsRoute.route("/", decisions);
