import { createRouter } from "@/lib/router.js";

import { ocr } from "./ocr.js";

import type { ServerTypes } from "@/vars.js";

export const ocrRoute = createRouter<ServerTypes>();

ocrRoute.route("/", ocr);
