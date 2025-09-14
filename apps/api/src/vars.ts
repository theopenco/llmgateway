import type { Variables } from "./auth/config";
import type { Env } from "hono/types";

export interface ServerTypes extends Env {
	Variables: Variables;
}
