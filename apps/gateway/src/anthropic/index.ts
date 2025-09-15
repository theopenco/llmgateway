import { OpenAPIHono } from "@hono/zod-openapi";

import { anthropic } from "./anthropic";

import type { ServerTypes } from "@/apps/gateway/src/vars";

export const exposed = new OpenAPIHono<ServerTypes>();

exposed.route("/messages", anthropic);
