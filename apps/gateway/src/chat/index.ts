import { createRouter } from "@/lib/router.js";

import { chat } from "./chat.js";

import type { ServerTypes } from "@/vars.js";

export const exposed = createRouter<ServerTypes>();

exposed.route("/chat", chat);
