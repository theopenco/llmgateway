import { createRouter } from "@/lib/router.js";

import { rerank } from "./rerank.js";

import type { ServerTypes } from "@/vars.js";

export const rerankRoute = createRouter<ServerTypes>();

rerankRoute.route("/", rerank);
