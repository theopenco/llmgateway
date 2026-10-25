import { createRouter } from "@/lib/router.js";

import { search } from "./search.js";

import type { ServerTypes } from "@/vars.js";

export const searchRoute = createRouter<ServerTypes>();

searchRoute.route("/", search);
