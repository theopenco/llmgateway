import { OpenAPIHono } from "@hono/zod-openapi";

import { speech } from "./speech.js";

import type { ServerTypes } from "@/vars.js";

export const speechRoute = new OpenAPIHono<ServerTypes>();

speechRoute.route("/", speech);
