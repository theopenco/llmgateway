import { createHmac } from "node:crypto";

const API_KEY_HASH_SECRET_ENV = "GATEWAY_API_KEY_HASH_SECRET";
const DEV_API_KEY_HASH_SECRET = "llmgateway-dev-api-key-hash-secret";

export const GATEWAY_API_KEY_PREFIX_PROD = "llmgtwy_";
export const GATEWAY_API_KEY_PREFIX_DEV = "llmgdev_";

export const MASTER_KEY_PREFIX_PROD = "llmgmk_";
export const MASTER_KEY_PREFIX_DEV = "llmgmkdev_";

export function getApiKeyHashSecret(): string {
	const configuredSecret = process.env[API_KEY_HASH_SECRET_ENV]?.trim();
	if (configuredSecret) {
		return configuredSecret;
	}

	if (process.env.NODE_ENV === "production") {
		throw new Error(
			`${API_KEY_HASH_SECRET_ENV} is required in production to hash API keys`,
		);
	}

	return DEV_API_KEY_HASH_SECRET;
}

export function getApiKeyFingerprint(token: string): string {
	// lgtm[js/insufficient-password-hash]
	return createHmac("sha256", getApiKeyHashSecret())
		.update(token)
		.digest("hex");
}

export function getMasterKeyPrefix(): string {
	return process.env.NODE_ENV === "development"
		? MASTER_KEY_PREFIX_DEV
		: MASTER_KEY_PREFIX_PROD;
}

export function getGatewayApiKeyPrefix(): string {
	return process.env.NODE_ENV === "development"
		? GATEWAY_API_KEY_PREFIX_DEV
		: GATEWAY_API_KEY_PREFIX_PROD;
}
