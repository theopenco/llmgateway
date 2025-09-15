import { OpenAPIHono } from "@hono/zod-openapi";

import { chat } from "./chat";

import type { ServerTypes } from "@/vars";

export const exposed = new OpenAPIHono<ServerTypes>();

exposed.route("/chat", chat);
