import { OpenAPIHono } from "@hono/zod-openapi";

import { anthropic } from "./anthropic.js";

import type { ServerTypes } from "@/vars.js";

export const exposed = new OpenAPIHono<ServerTypes>();

exposed.route("/messages", anthropic);
