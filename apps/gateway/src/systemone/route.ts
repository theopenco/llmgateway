import { OpenAPIHono } from "@hono/zod-openapi";

import { systemone } from "./systemone.js";

import type { ServerTypes } from "@/vars.js";

export const systemoneRoute = new OpenAPIHono<ServerTypes>();

systemoneRoute.route("/", systemone);
