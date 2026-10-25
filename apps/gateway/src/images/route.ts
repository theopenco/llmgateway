import { createRouter } from "@/lib/router.js";

import { images } from "./images.js";

import type { ServerTypes } from "@/vars.js";

export const imagesRoute = createRouter<ServerTypes>();

imagesRoute.route("/", images);
