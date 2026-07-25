import {
	createCipheriv,
	createDecipheriv,
	hkdfSync,
	randomBytes,
} from "node:crypto";

import { getApiKeyHashSecret } from "@llmgateway/shared/api-key-hash";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

const FORMAT_PREFIX = "llmgw:v1:";
const HKDF_INFO_PROVIDER_KEY_TOKEN = "provider-key-token:v1";

function decodeBase64UrlNoPad(input: string): Buffer {
	const padded = input + "==".slice(0, (4 - (input.length % 4)) % 4);
	const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
	return Buffer.from(base64, "base64");
}

function encodeBase64UrlNoPad(buf: Buffer): string {
	return buf
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

/**
 * Derives the provider-key data key from the gateway's shared secret
 * (GATEWAY_API_KEY_HASH_SECRET). The HKDF info string domain-separates it from
 * the API-key fingerprint HMAC, so the two uses never share key material.
 */
function getDataKey(): Buffer {
	const derived = hkdfSync(
		"sha256",
		Buffer.from(getApiKeyHashSecret(), "utf8"),
		Buffer.alloc(0),
		Buffer.from(HKDF_INFO_PROVIDER_KEY_TOKEN, "utf8"),
		KEY_BYTES,
	);
	return Buffer.from(derived);
}

function buildAad(rowId: string, organizationId: string): Buffer {
	return Buffer.from(`provider_key|${rowId}|${organizationId}`, "utf8");
}

/**
 * Encrypts a provider key plaintext for storage in provider_key.token_ciphertext.
 * AAD binds the ciphertext to the row id and organization id; copying the
 * ciphertext to another row or another org will fail GCM verification on decrypt.
 */
export function encryptProviderKey(
	plaintext: string,
	rowId: string,
	organizationId: string,
): string {
	const iv = randomBytes(IV_BYTES);
	const aad = buildAad(rowId, organizationId);
	const cipher = createCipheriv(ALGORITHM, getDataKey(), iv);
	cipher.setAAD(aad);
	const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	const tag = cipher.getAuthTag();
	return [
		FORMAT_PREFIX.slice(0, -1),
		encodeBase64UrlNoPad(iv),
		encodeBase64UrlNoPad(ct),
		encodeBase64UrlNoPad(tag),
	].join(":");
}

/**
 * Decrypts a provider key ciphertext produced by encryptProviderKey.
 * Throws on any failure (unknown prefix, wrong shape, tag mismatch, wrong AAD).
 * Callers must not fall back to plaintext on failure.
 */
export function decryptProviderKey(
	ciphertext: string,
	rowId: string,
	organizationId: string,
): string {
	if (!ciphertext.startsWith(FORMAT_PREFIX)) {
		throw new Error(
			`provider_key ${rowId}: unknown ciphertext version (expected ${FORMAT_PREFIX} prefix)`,
		);
	}
	const parts = ciphertext.split(":");
	if (parts.length !== 5) {
		throw new Error(
			`provider_key ${rowId}: malformed ciphertext (expected 5 colon-separated parts, got ${parts.length})`,
		);
	}
	const [, , ivB64, ctB64, tagB64] = parts;
	const iv = decodeBase64UrlNoPad(ivB64);
	const ct = decodeBase64UrlNoPad(ctB64);
	const tag = decodeBase64UrlNoPad(tagB64);
	if (iv.length !== IV_BYTES) {
		throw new Error(
			`provider_key ${rowId}: invalid iv length ${iv.length}, expected ${IV_BYTES}`,
		);
	}
	if (tag.length !== TAG_BYTES) {
		throw new Error(
			`provider_key ${rowId}: invalid tag length ${tag.length}, expected ${TAG_BYTES}`,
		);
	}
	const aad = buildAad(rowId, organizationId);
	const decipher = createDecipheriv(ALGORITHM, getDataKey(), iv);
	decipher.setAAD(aad);
	decipher.setAuthTag(tag);
	const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
	return pt.toString("utf8");
}

/**
 * Returns true if the given string looks like a llmgw:v1: ciphertext.
 * This is a cheap shape check used at the API/UI boundary only;
 * the gateway's read path keys off column nullity, not this predicate.
 */
export function isProviderKeyCiphertext(value: string): boolean {
	return value.startsWith(FORMAT_PREFIX);
}
