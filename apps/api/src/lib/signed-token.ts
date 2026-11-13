import { createHmac, timingSafeEqual } from "node:crypto";

import {
	getApiKeyHashSecret,
	getApiKeyHashSecrets,
} from "@llmgateway/shared/api-key-hash";

const TOKEN_VERSION = "v1";

function sign(domain: string, payload: string, secret: string): string {
	return createHmac("sha256", secret)
		.update(`${domain}:${payload}`)
		.digest("base64url");
}

/**
 * A `v1.<payload>.<hmac>` link token carrying `data` until `expiresAt` (ms).
 * `domain` separates token kinds, so one kind never verifies as another.
 */
export function signLinkToken(
	domain: string,
	data: Record<string, string>,
	expiresAt: number,
): string {
	const payload = Buffer.from(
		JSON.stringify({ ...data, x: expiresAt }),
	).toString("base64url");
	return `${TOKEN_VERSION}.${payload}.${sign(domain, payload, getApiKeyHashSecret())}`;
}

/**
 * The data a link token was issued with, or null when it is forged, malformed
 * or expired. Checked against every keyring entry so rotating the secret keeps
 * links already in inboxes working.
 */
export function verifyLinkToken<T extends Record<string, string>>(
	domain: string,
	token: string,
	now: Date = new Date(),
): T | null {
	const parts = token.split(".");
	const [version, payload, signature] = parts;
	if (
		parts.length !== 3 ||
		version !== TOKEN_VERSION ||
		!payload ||
		!signature
	) {
		return null;
	}
	const provided = Buffer.from(signature);
	const matches = getApiKeyHashSecrets().some((secret) => {
		const expected = Buffer.from(sign(domain, payload, secret));
		return (
			provided.length === expected.length && timingSafeEqual(provided, expected)
		);
	});
	if (!matches) {
		return null;
	}
	const { x, ...data } = JSON.parse(
		Buffer.from(payload, "base64url").toString("utf8"),
	) as { x: number } & T;
	return x > now.getTime() ? (data as unknown as T) : null;
}
