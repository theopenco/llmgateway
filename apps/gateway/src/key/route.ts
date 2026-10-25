import { OpenAPIHono } from "@hono/zod-openapi";

import { key } from "./key.js";

import type { ServerTypes } from "@/vars.js";

export const keyRoute = new OpenAPIHono<ServerTypes>();

keyRoute.route("/", key);
