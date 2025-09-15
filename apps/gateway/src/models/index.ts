import { OpenAPIHono } from "@hono/zod-openapi";

import { modelsApi } from "./models";

import type { ServerTypes } from "@/vars";

export const models = new OpenAPIHono<ServerTypes>();

models.route("/", modelsApi);
