import { OpenAPIHono } from "@hono/zod-openapi";

import { ocr } from "./ocr.js";

import type { ServerTypes } from "@/vars.js";

export const ocrRoute = new OpenAPIHono<ServerTypes>();

ocrRoute.route("/", ocr);
