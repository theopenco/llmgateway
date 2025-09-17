import type { Variables } from "./auth/config.js";
import type { Env } from "hono/types";

export interface ServerTypes extends Env {
	Variables: Variables;
}
