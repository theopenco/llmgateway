import { createHmac } from "node:crypto";

const API_KEY_HASH_SECRET_ENV = "GATEWAY_API_KEY_HASH_SECRET";
const DEV_API_KEY_HASH_SECRET = "llmgateway-dev-api-key-hash-secret";

function getApiKeyHashSecret(): string {
	const configuredSecret = process.env[API_KEY_HASH_SECRET_ENV]?.trim();
	if (configuredSecret) {
		return configuredSecret;
	}

	if (process.env.NODE_ENV === "production") {
		throw new Error(
			`${API_KEY_HASH_SECRET_ENV} is required in production to hash logged provider API keys`,
		);
	}

	return DEV_API_KEY_HASH_SECRET;
}

export function getApiKeyFingerprint(token: string): string {
	return createHmac("sha256", getApiKeyHashSecret())
		.update(token)
		.digest("hex");
}
