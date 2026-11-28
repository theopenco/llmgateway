import { HTTPException } from "hono/http-exception";

import { logger } from "@llmgateway/logger";

export const PRICING_NOT_CONFIGURED_MESSAGE =
	"Subscription pricing is not configured";

// Reads a Stripe price id from the environment. A missing one is logged with
// the variable name and surfaces to the client only as a generic 500.
export function requirePriceId(envKey: string): string {
	const priceId = process.env[envKey];
	if (!priceId) {
		logger.error(`${envKey} environment variable is not set`);
		throw new HTTPException(500, { message: PRICING_NOT_CONFIGURED_MESSAGE });
	}
	return priceId;
}
