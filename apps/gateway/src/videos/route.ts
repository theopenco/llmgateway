import { createRouter } from "@/lib/router.js";

import { videos } from "./videos.js";

import type { ServerTypes } from "@/vars.js";

export const videosRoute = createRouter<ServerTypes>();

videosRoute.route("/", videos);
