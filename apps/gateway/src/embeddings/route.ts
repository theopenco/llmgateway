import { OpenAPIHono } from "@hono/zod-openapi";

import { embeddings } from "./embeddings.js";

import type { ServerTypes } from "@/vars.js";

export const embeddingsRoute = new OpenAPIHono<ServerTypes>();

embeddingsRoute.route("/", embeddings);
