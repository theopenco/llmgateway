import { createRouter } from "@/lib/router.js";

import { transcriptions } from "./transcriptions.js";

import type { ServerTypes } from "@/vars.js";

export const transcriptionsRoute = createRouter<ServerTypes>();

transcriptionsRoute.route("/", transcriptions);
