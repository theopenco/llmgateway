import { createRouter } from "@/lib/router.js";

import { systemone } from "./systemone.js";

import type { ServerTypes } from "@/vars.js";

export const systemoneRoute = createRouter<ServerTypes>();

systemoneRoute.route("/", systemone);
