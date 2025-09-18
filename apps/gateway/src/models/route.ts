import { OpenAPIHono } from "@hono/zod-openapi";

import { modelsApi } from "./models.js";

import type { ServerTypes } from "@/vars.js";

export const models = new OpenAPIHono<ServerTypes>();

models.route("/", modelsApi);
