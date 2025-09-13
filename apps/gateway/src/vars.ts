import type { Env } from "hono/types";

export interface ServerTypes extends Env {
	Variables: {
		traceId?: string;
		spanId?: string;
	};
}
