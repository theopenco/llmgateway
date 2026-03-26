import { OpenAPIHono } from "@hono/zod-openapi";

import { moderations } from "./moderations.js";

import type { ServerTypes } from "@/vars.js";

export const moderationsRoute = new OpenAPIHono<ServerTypes>();

moderationsRoute.route("/", moderations);
