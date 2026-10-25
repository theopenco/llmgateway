import { createRouter } from "@/lib/router.js";

import { decisions } from "./decisions.js";

import type { ServerTypes } from "@/vars.js";

export const decisionsRoute = createRouter<ServerTypes>();

decisionsRoute.route("/", decisions);
