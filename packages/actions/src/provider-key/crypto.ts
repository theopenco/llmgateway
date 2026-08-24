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
} from "@llmgateway/shared/api-key-hash";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

// v1: llmgw:v1:<iv>:<ct>:<tag> — no key id; decryption trial-decrypts against
// every keyring secret. Only rows written before v2 shipped carry this format.
// v2: llmgw:v2:<kid>:<iv>:<ct>:<tag> — kid names the keyring secret that
// encrypted the row (see getSecretKeyId), so a rotated deployment can pick the
// right secret directly and report precisely when it has been dropped too early.
const FORMAT_PREFIX_V1 = "llmgw:v1:";
const FORMAT_PREFIX_V2 = "llmgw:v2:";
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
 * Derives the provider-key data key from a gateway secret (an entry of the
 * GATEWAY_API_KEY_HASH_SECRET keyring). The HKDF info string domain-separates
 * it from the API-key fingerprint HMAC, so the two uses never share key
 * material.
 */
function getDataKey(secret: string): Buffer {
	const derived = hkdfSync(
		"sha256",
		Buffer.from(secret, "utf8"),
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
 * Always encrypts with the current (first) keyring secret and stamps its key id
 * into the llmgw:v2 format. AAD binds the ciphertext to the row id and
 * organization id; copying the ciphertext to another row or another org will
 * fail GCM verification on decrypt.
 */
export function encryptProviderKey(
	plaintext: string,
	rowId: string,
	organizationId: string,
): string {
	const secret = getApiKeyHashSecret();
	const iv = randomBytes(IV_BYTES);
	const aad = buildAad(rowId, organizationId);
	const cipher = createCipheriv(ALGORITHM, getDataKey(secret), iv);
	cipher.setAAD(aad);
	const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	const tag = cipher.getAuthTag();
	return [
		FORMAT_PREFIX_V2.slice(0, -1),
		getSecretKeyId(secret),
		encodeBase64UrlNoPad(iv),
		encodeBase64UrlNoPad(ct),
		encodeBase64UrlNoPad(tag),
	].join(":");
}

interface CiphertextParts {
	iv: Buffer;
	ct: Buffer;
	tag: Buffer;
}

function parseParts(
	rowId: string,
	ivB64: string,
	ctB64: string,
	tagB64: string,
): CiphertextParts {
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
	return { iv, ct, tag };
}

function decryptWithSecret(
	secret: string,
	parts: CiphertextParts,
	aad: Buffer,
): string {
	const decipher = createDecipheriv(ALGORITHM, getDataKey(secret), parts.iv);
	decipher.setAAD(aad);
	decipher.setAuthTag(parts.tag);
	const pt = Buffer.concat([decipher.update(parts.ct), decipher.final()]);
	return pt.toString("utf8");
}

function decryptWithCandidates(
	rowId: string,
	secrets: string[],
	parts: CiphertextParts,
	aad: Buffer,
	exhaustedMessage: string,
): string {
	for (const secret of secrets) {
		try {
			return decryptWithSecret(secret, parts, aad);
		} catch {
			// GCM tag mismatch — wrong keyring entry, tampering, or wrong AAD
			// scope; indistinguishable here, so try the next candidate.
		}
	}
	throw new Error(`provider_key ${rowId}: ${exhaustedMessage}`);
}

/**
 * Decrypts a provider key ciphertext produced by encryptProviderKey.
 * Throws on any failure (unknown prefix, wrong shape, unknown key id, tag
 * mismatch, wrong AAD). Callers must not fall back to plaintext on failure.
 *
 * llmgw:v2 ciphertexts resolve their keyring secret by the embedded key id;
 * legacy llmgw:v1 ciphertexts are trial-decrypted against every keyring entry.
 */
export function decryptProviderKey(
	ciphertext: string,
	rowId: string,
	organizationId: string,
): string {
	const aad = buildAad(rowId, organizationId);
	const secrets = getApiKeyHashSecrets();

	if (ciphertext.startsWith(FORMAT_PREFIX_V2)) {
		const parts = ciphertext.split(":");
		if (parts.length !== 6) {
			throw new Error(
				`provider_key ${rowId}: malformed ciphertext (expected 6 colon-separated parts, got ${parts.length})`,
			);
		}
		const [, , kid, ivB64, ctB64, tagB64] = parts;
		const candidates = secrets.filter(
			(secret) => getSecretKeyId(secret) === kid,
		);
		if (candidates.length === 0) {
			throw new Error(
				`provider_key ${rowId}: encrypted with key id ${kid}, which is not in the GATEWAY_API_KEY_HASH_SECRET keyring (was the old secret removed before re-encrypting?)`,
			);
		}
		return decryptWithCandidates(
			rowId,
			candidates,
			parseParts(rowId, ivB64, ctB64, tagB64),
			aad,
			`decryption failed for key id ${kid} (tampered ciphertext or wrong row/org scope)`,
		);
	}

	if (ciphertext.startsWith(FORMAT_PREFIX_V1)) {
		const parts = ciphertext.split(":");
		if (parts.length !== 5) {
			throw new Error(
				`provider_key ${rowId}: malformed ciphertext (expected 5 colon-separated parts, got ${parts.length})`,
			);
		}
		const [, , ivB64, ctB64, tagB64] = parts;
		return decryptWithCandidates(
			rowId,
			secrets,
			parseParts(rowId, ivB64, ctB64, tagB64),
			aad,
			`decryption failed with all ${secrets.length} keyring secret(s) (rotated-out secret, tampered ciphertext, or wrong row/org scope)`,
		);
	}

	throw new Error(
		`provider_key ${rowId}: unknown ciphertext version (expected ${FORMAT_PREFIX_V1} or ${FORMAT_PREFIX_V2} prefix)`,
	);
}

/**
 * Returns true if the given string looks like a llmgw:v1/v2 ciphertext.
 * This is a cheap shape check used at the API/UI boundary only;
 * the gateway's read path keys off column nullity, not this predicate.
 */
export function isProviderKeyCiphertext(value: string): boolean {
	return (
		value.startsWith(FORMAT_PREFIX_V1) || value.startsWith(FORMAT_PREFIX_V2)
	);
}
