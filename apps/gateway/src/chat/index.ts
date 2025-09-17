import { OpenAPIHono } from "@hono/zod-openapi";

import { chat } from "./chat.js";

import type { ServerTypes } from "@/vars.js";

export const exposed = new OpenAPIHono<ServerTypes>();

exposed.route("/chat", chat);
