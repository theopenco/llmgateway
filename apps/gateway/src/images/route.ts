import { OpenAPIHono } from "@hono/zod-openapi";

import { images } from "./images.js";

import type { ServerTypes } from "@/vars.js";

export const imagesRoute = new OpenAPIHono<ServerTypes>();

imagesRoute.route("/", images);
