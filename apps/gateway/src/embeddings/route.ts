import { createRouter } from "@/lib/router.js";

import { embeddings } from "./embeddings.js";

import type { ServerTypes } from "@/vars.js";

export const embeddingsRoute = createRouter<ServerTypes>();

embeddingsRoute.route("/", embeddings);
