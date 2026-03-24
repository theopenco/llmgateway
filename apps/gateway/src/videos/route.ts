import { OpenAPIHono } from "@hono/zod-openapi";

import { videos } from "./videos.js";

import type { ServerTypes } from "@/vars.js";

export const videosRoute = new OpenAPIHono<ServerTypes>();

videosRoute.route("/", videos);
