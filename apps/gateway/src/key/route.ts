import { createRouter } from "@/lib/router.js";

import { key } from "./key.js";

import type { ServerTypes } from "@/vars.js";

export const keyRoute = createRouter<ServerTypes>();

keyRoute.route("/", key);
