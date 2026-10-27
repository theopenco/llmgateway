import { createRouter } from "@/lib/router.js";

import { anthropic } from "./anthropic.js";

import type { ServerTypes } from "@/vars.js";

export const exposed = createRouter<ServerTypes>();

exposed.route("/messages", anthropic);
