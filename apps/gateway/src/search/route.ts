import { OpenAPIHono } from "@hono/zod-openapi";

import { search } from "./search.js";

import type { ServerTypes } from "@/vars.js";

export const searchRoute = new OpenAPIHono<ServerTypes>();

searchRoute.route("/", search);
