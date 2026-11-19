import {
	createCipheriv,
	createDecipheriv,
	hkdfSync,
	randomBytes,
} from "node:crypto";

import {
	getApiKeyHashSecret,
	getApiKeyHashSecrets,
	getSecretKeyId,
} from "./api-key-hash.js";
import { decodeBase64UrlNoPad, encodeBase64UrlNoPad } from "./base64url.js";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
// llmgw:cfp1:<kid>:<iv>:<ct>:<tag>; kid names the keyring secret (see
// getSecretKeyId). A rotated-out secret must stay in the keyring until the
// rows it encrypted expire, at most a year after a report.
const FORMAT_PREFIX = "llmgw:cfp1:";
// Domain-separates this key from the provider-key key and the API-key HMAC,
// which derive from the same GATEWAY_API_KEY_HASH_SECRET keyring.
const HKDF_INFO = "content-filter-flagged-payload:v1";

function getDataKey(secret: string): Buffer {
	return Buffer.from(
		hkdfSync(
			"sha256",
			Buffer.from(secret, "utf8"),
			Buffer.alloc(0),
			Buffer.from(HKDF_INFO, "utf8"),
			KEY_BYTES,
		),
	);
}

function buildAad(rowId: string, organizationId: string): Buffer {
	return Buffer.from(
		`content_filter_flagged_payload|${rowId}|${organizationId}`,
		"utf8",
	);
}

/**
 * Encrypts a flagged payload for `content_filter_flagged_payload.payload_ciphertext`
 * with the current keyring secret. AAD binds it to the row and organization.
 */
export function encryptFlaggedPayload(
	plaintext: string,
	rowId: string,
	organizationId: string,
): string {
	const secret = getApiKeyHashSecret();
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv(ALGORITHM, getDataKey(secret), iv);
	cipher.setAAD(buildAad(rowId, organizationId));
	const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	return [
		FORMAT_PREFIX.slice(0, -1),
		getSecretKeyId(secret),
		encodeBase64UrlNoPad(iv),
		encodeBase64UrlNoPad(ct),
		encodeBase64UrlNoPad(cipher.getAuthTag()),
	].join(":");
}

/** Decrypts {@link encryptFlaggedPayload} output; throws on any mismatch. */
export function decryptFlaggedPayload(
	ciphertext: string,
	rowId: string,
	organizationId: string,
): string {
	if (!ciphertext.startsWith(FORMAT_PREFIX)) {
		throw new Error(`flagged payload ${rowId}: unknown ciphertext format`);
	}
	const parts = ciphertext.split(":");
	if (parts.length !== 6) {
		throw new Error(`flagged payload ${rowId}: malformed ciphertext`);
	}
	const [, , kid, ivB64, ctB64, tagB64] = parts;
	const secret = getApiKeyHashSecrets().find(
		(candidate) => getSecretKeyId(candidate) === kid,
	);
	if (!secret) {
		throw new Error(
			`flagged payload ${rowId}: encrypted with key id ${kid}, which is not in the GATEWAY_API_KEY_HASH_SECRET keyring`,
		);
	}
	const iv = decodeBase64UrlNoPad(ivB64);
	const tag = decodeBase64UrlNoPad(tagB64);
	if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
		throw new Error(`flagged payload ${rowId}: malformed ciphertext`);
	}
	const decipher = createDecipheriv(ALGORITHM, getDataKey(secret), iv);
	decipher.setAAD(buildAad(rowId, organizationId));
	decipher.setAuthTag(tag);
	return Buffer.concat([
		decipher.update(decodeBase64UrlNoPad(ctB64)),
		decipher.final(),
	]).toString("utf8");
}
