import { createRouter } from "@/lib/router.js";

import { moderations } from "./moderations.js";

import type { ServerTypes } from "@/vars.js";

export const moderationsRoute = createRouter<ServerTypes>();

moderationsRoute.route("/", moderations);
