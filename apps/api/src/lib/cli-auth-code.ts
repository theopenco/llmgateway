import {
	createCipheriv,
	createDecipheriv,
	createHash,
	createHmac,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";

import { redisClient } from "@/auth/config.js";

import { getApiKeyHashSecret } from "@llmgateway/shared/api-key-hash";

// The browser login hands the CLI a one-time code instead of the API key, so
// the key never appears in a URL. The CLI redeems it with its PKCE verifier
// (RFC 7636, S256), which only the CLI process knows.
export const CLI_AUTH_CODE_TTL_SECONDS = 5 * 60;

// A base64url-encoded SHA-256 digest is always 43 characters.
export const CLI_CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

interface StoredCode {
	challenge: string;
	expiresAt: string | null;
	iv: string;
	data: string;
	tag: string;
}

function storageKey(code: string): string {
	const digest = createHmac("sha256", getApiKeyHashSecret())
		.update(`cli-auth-code:${code}`)
		.digest("hex");
	return `cli_auth_code:${digest}`;
}

// The stored key is encrypted with a key derived from the code, so the Redis
// entry alone cannot reveal it.
function encryptionKey(code: string): Buffer {
	return createHash("sha256").update(`cli-auth-code-key:${code}`).digest();
}

function s256(verifier: string): string {
	return createHash("sha256").update(verifier).digest("base64url");
}

export async function issueCliAuthCode(input: {
	token: string;
	codeChallenge: string;
	expiresAt: Date | null;
}): Promise<string> {
	const code = randomBytes(32).toString("base64url");
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", encryptionKey(code), iv);
	const data = Buffer.concat([cipher.update(input.token), cipher.final()]);
	const stored: StoredCode = {
		challenge: input.codeChallenge,
		expiresAt: input.expiresAt?.toISOString() ?? null,
		iv: iv.toString("base64url"),
		data: data.toString("base64url"),
		tag: cipher.getAuthTag().toString("base64url"),
	};
	await redisClient.set(
		storageKey(code),
		JSON.stringify(stored),
		"EX",
		CLI_AUTH_CODE_TTL_SECONDS,
	);
	return code;
}

/**
 * Consumes the code on the first attempt, right or wrong, so a code can be
 * tried at most once. Returns null for an unknown, expired, or mismatched code.
 */
export async function redeemCliAuthCode(
	code: string,
	verifier: string,
): Promise<{ token: string; expiresAt: string | null } | null> {
	const key = storageKey(code);
	const results = await redisClient.multi().get(key).del(key).exec();
	const raw = results?.[0]?.[1];
	if (typeof raw !== "string") {
		return null;
	}
	const stored = JSON.parse(raw) as StoredCode;
	const expected = Buffer.from(stored.challenge);
	const actual = Buffer.from(s256(verifier));
	if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
		return null;
	}
	const decipher = createDecipheriv(
		"aes-256-gcm",
		encryptionKey(code),
		Buffer.from(stored.iv, "base64url"),
	);
	decipher.setAuthTag(Buffer.from(stored.tag, "base64url"));
	const token = Buffer.concat([
		decipher.update(Buffer.from(stored.data, "base64url")),
		decipher.final(),
	]).toString();
	return { token, expiresAt: stored.expiresAt };
}
