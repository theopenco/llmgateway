import { OpenAPIHono } from "@hono/zod-openapi";

import { rerank } from "./rerank.js";

import type { ServerTypes } from "@/vars.js";

export const rerankRoute = new OpenAPIHono<ServerTypes>();

rerankRoute.route("/", rerank);
