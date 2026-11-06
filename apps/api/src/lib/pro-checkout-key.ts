import { createHmac } from "node:crypto";

import { getApiKeyHashSecret } from "@llmgateway/shared/api-key-hash";

export function proCheckoutContextHash(context: string): string {
	return createHmac("sha256", getApiKeyHashSecret())
		.update(`pro-checkout-context:${context}`)
		.digest("base64url");
}

export function proCheckoutIdempotencyKey(
	context: string,
	generation: string,
	publicParts: readonly (string | number | boolean)[],
): string {
	const digest = proCheckoutContextHash(JSON.stringify([context, generation]));
	const suffix = publicParts
		.map((part) => {
			if (
				typeof part === "string"
					? !/^price_[A-Za-z0-9_]+$/.test(part)
					: typeof part === "number" &&
						(!Number.isSafeInteger(part) || part < 0 || part > 500)
			) {
				throw new Error("Invalid public checkout configuration");
			}
			return encodeURIComponent(String(part));
		})
		.join("/");
	const key = `pro-checkout-${digest}/${suffix}`;
	if (Buffer.byteLength(key, "utf8") > 255) {
		throw new Error(
			"Pro checkout configuration exceeds the idempotency key limit",
		);
	}
	return key;
}
