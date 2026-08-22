import { createHmac, hkdfSync } from "node:crypto";

import { maskToken } from "./mask-token.js";

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
 * Gateway API-key, master-key, and SCIM authentication check every keyring
 * entry. Only log.usedApiKeyHash uses the current secret alone; historical log
 * fingerprints are not used for authentication.
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
	return getApiKeyFingerprintWithSecret(token, getApiKeyHashSecret());
}

function getApiKeyFingerprintWithSecret(token: string, secret: string): string {
	// API keys are high-entropy random bearer tokens, not user passwords. A keyed
	// HMAC provides deterministic lookup without exposing their plaintext.
	// lgtm[js/insufficient-password-hash]
	return createHmac("sha256", secret).update(token).digest("hex");
}

/** Fingerprints an incoming token against every configured keyring secret. */
export function getApiKeyFingerprints(token: string): string[] {
	return getApiKeyHashSecrets().map((secret) =>
		getApiKeyFingerprintWithSecret(token, secret),
	);
}

/** Values persisted for a gateway API key. The plaintext is returned separately. */
export function hashApiKeyForStorage(token: string) {
	return {
		token: null,
		tokenHash: getApiKeyFingerprint(token),
		tokenMasked: maskToken(token),
	} as const;
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
