import { createRouter } from "@/lib/router.js";

import { modelsApi } from "./models.js";

import type { ServerTypes } from "@/vars.js";

export const models = createRouter<ServerTypes>();

models.route("/", modelsApi);
