import { createHmac, hkdfSync } from "node:crypto";

const API_KEY_HASH_SECRET_ENV = "GATEWAY_API_KEY_HASH_SECRET";
const DEV_API_KEY_HASH_SECRET = "llmgateway-dev-api-key-hash-secret";

const SECRET_KEY_ID_HKDF_INFO = "gateway-secret-key-id:v1";
const SECRET_KEY_ID_BYTES = 4;

export const GATEWAY_API_KEY_PREFIX_PROD = "llmgtwy_";
export const GATEWAY_API_KEY_PREFIX_DEV = "llmgdev_";

export const MASTER_KEY_PREFIX_PROD = "llmgmk_";
export const MASTER_KEY_PREFIX_DEV = "llmgmkdev_";

/**
 * Returns the gateway secret keyring, newest first.
 *
 * GATEWAY_API_KEY_HASH_SECRET holds one or more comma-separated secrets. The
 * first entry is the CURRENT secret: every new HMAC fingerprint and every new
 * provider-key encryption uses it. Older entries exist only so provider-key
 * ciphertexts written under a previous secret stay decryptable during a
 * rotation (rotate by prepending the new secret, keep the old one until all
 * ciphertexts are re-encrypted, then drop it).
 *
 * Rotation is currently supported for provider-key ciphertexts only. Persisted
 * HMAC lookups (master_key.tokenHash, scim_token.tokenHash, log.usedApiKeyHash)
 * are computed and matched with the current secret alone — rotating the secret
 * invalidates those hashes until multi-secret lookup / re-stamping ships.
 */
export function getApiKeyHashSecrets(): string[] {
	const secrets = (process.env[API_KEY_HASH_SECRET_ENV] ?? "")
		.split(",")
		.map((secret) => secret.trim())
		.filter(Boolean);
	if (secrets.length > 0) {
		return secrets;
	}

	if (process.env.NODE_ENV === "production") {
		throw new Error(
			`${API_KEY_HASH_SECRET_ENV} is required in production to hash API keys`,
		);
	}

	return [DEV_API_KEY_HASH_SECRET];
}

/** The current (newest) gateway secret. See getApiKeyHashSecrets(). */
export function getApiKeyHashSecret(): string {
	return getApiKeyHashSecrets()[0];
}

/**
 * Short stable identifier for a gateway secret, embedded in provider-key
 * ciphertexts (llmgw:v2) so decryption can pick the right keyring entry
 * without trial decryption. One-way (HKDF with its own info string), so the
 * id stored in the database reveals nothing about the secret itself.
 */
export function getSecretKeyId(secret: string): string {
	return Buffer.from(
		hkdfSync(
			"sha256",
			Buffer.from(secret, "utf8"),
			Buffer.alloc(0),
			Buffer.from(SECRET_KEY_ID_HKDF_INFO, "utf8"),
			SECRET_KEY_ID_BYTES,
		),
	).toString("hex");
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
