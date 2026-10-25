import { createRouter } from "@/lib/router.js";

import { speech } from "./speech.js";

import type { ServerTypes } from "@/vars.js";

export const speechRoute = createRouter<ServerTypes>();

speechRoute.route("/", speech);
