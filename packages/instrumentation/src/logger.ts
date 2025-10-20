import { logger as honoLogger } from "hono/logger";

import { logger } from "@llmgateway/logger";

export interface HonoRequestLoggerOptions {
	service: string;
}

export function createHonoRequestLogger(options: HonoRequestLoggerOptions) {
	if (process.env.NODE_ENV === "production") {
		return async (c: any, next: any) => await next();
	}

	return honoLogger((message: string, ...args: any) => {
		logger.info(message, {
			kind: "request",
			service: options.service,
			source: "hono-logger",
			args,
		});
	});
}
