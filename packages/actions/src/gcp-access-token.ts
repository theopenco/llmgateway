import * as crypto from "node:crypto";

import { redisClient } from "@llmgateway/cache";
import { logger } from "@llmgateway/logger";
import { getApiKeyHashSecret } from "@llmgateway/shared/api-key-hash";

interface ServiceAccountKey {
	client_email: string;
	private_key: string;
	project_id: string;
}

// Service-account JSON is user-supplied, so its token_uri is ignored: fetching
// it would let a key point the server at internal hosts.
export const GOOGLE_OAUTH_TOKEN_URI = "https://oauth2.googleapis.com/token";

const REDIS_KEY_PREFIX = "gcp:service-account:access_token";
// Google access tokens live for `expires_in` seconds (normally one hour).
// Cached entries carry their absolute expiry so a pod that picks up a token
// from Redis late never extends its lifetime past the upstream expiry.
const DEFAULT_EXPIRES_IN_SECONDS = 3600;
const EXPIRY_SAFETY_MARGIN_SECONDS = 10 * 60;
const MIN_CACHE_SECONDS = 60;
const MS_PER_SECOND = 1000;

interface CachedToken {
	token: string;
	expiresAt: number;
}

const memoryCache = new Map<string, CachedToken>();

function parseCachedToken(raw: string): CachedToken | null {
	try {
		const parsed = JSON.parse(raw) as Partial<CachedToken> | null;
		if (
			parsed &&
			typeof parsed.token === "string" &&
			typeof parsed.expiresAt === "number"
		) {
			return { token: parsed.token, expiresAt: parsed.expiresAt };
		}
	} catch (err) {
		logger.warn(
			"Discarding malformed cached GCP service account token",
			err instanceof Error ? err : new Error(String(err)),
		);
	}
	return null;
}

function abortError(abortSignal: AbortSignal): Error {
	return abortSignal.reason instanceof Error
		? abortSignal.reason
		: new Error("Operation aborted");
}

async function withAbortSignal<T>(
	operation: Promise<T>,
	abortSignal?: AbortSignal,
): Promise<T> {
	if (!abortSignal) {
		return await operation;
	}
	abortSignal.throwIfAborted();
	return await new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(abortError(abortSignal));
		abortSignal.addEventListener("abort", onAbort, { once: true });
		operation.then(
			(value) => {
				abortSignal.removeEventListener("abort", onAbort);
				resolve(value);
			},
			(error: unknown) => {
				abortSignal.removeEventListener("abort", onAbort);
				reject(error instanceof Error ? error : new Error(String(error)));
			},
		);
	});
}

function rethrowAbort(abortSignal?: AbortSignal): void {
	if (abortSignal?.aborted) {
		throw abortError(abortSignal);
	}
}

function base64url(data: Buffer | string): string {
	const buf = typeof data === "string" ? Buffer.from(data) : data;
	return buf.toString("base64url");
}

function parseServiceAccount(json: string): ServiceAccountKey | null {
	try {
		return JSON.parse(json) as ServiceAccountKey;
	} catch (err) {
		logger.error(
			"Failed to parse GCP service account JSON",
			err instanceof Error ? err : new Error(String(err)),
		);
		return null;
	}
}

function signJwt(sa: ServiceAccountKey): string {
	const header = { alg: "RS256", typ: "JWT" };
	const iat = Math.floor(Date.now() / 1000);
	const claim = {
		iss: sa.client_email,
		scope: "https://www.googleapis.com/auth/cloud-platform",
		aud: GOOGLE_OAUTH_TOKEN_URI,
		iat,
		exp: iat + 3600,
	};

	const headerEncoded = base64url(JSON.stringify(header));
	const claimEncoded = base64url(JSON.stringify(claim));
	const signingInput = `${headerEncoded}.${claimEncoded}`;
	const signature = crypto
		.createSign("RSA-SHA256")
		.update(signingInput)
		.sign(sa.private_key);
	return `${signingInput}.${base64url(signature)}`;
}

async function exchangeJwtForAccessToken(
	sa: ServiceAccountKey,
	abortSignal?: AbortSignal,
): Promise<CachedToken> {
	const jwt = signJwt(sa);
	const res = await fetch(GOOGLE_OAUTH_TOKEN_URI, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
			assertion: jwt,
		}),
		signal: abortSignal,
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(
			`Failed to exchange JWT for GCP access token: ${res.status} ${text}`,
		);
	}

	const data = (await res.json()) as {
		access_token?: string;
		expires_in?: number;
	};
	if (!data.access_token) {
		throw new Error("GCP token endpoint returned no access_token");
	}
	const expiresIn =
		typeof data.expires_in === "number" && data.expires_in > 0
			? data.expires_in
			: DEFAULT_EXPIRES_IN_SECONDS;
	const cacheSeconds = Math.max(
		expiresIn - EXPIRY_SAFETY_MARGIN_SECONDS,
		MIN_CACHE_SECONDS,
	);
	const cacheMs = cacheSeconds * MS_PER_SECOND;
	return { token: data.access_token, expiresAt: Date.now() + cacheMs };
}

/**
 * Keyed on the whole credential, not just client_email: the JSON is
 * user-supplied, so a key reusing another tenant's client_email with any
 * private_key must not hit that tenant's cached token.
 */
function cacheKey(sa: ServiceAccountKey): string {
	const fingerprint = crypto
		.createHmac("sha256", getApiKeyHashSecret())
		.update("gcp-service-account-token:v2\0")
		.update(sa.client_email)
		.update("\0")
		.update(sa.private_key)
		.digest("hex");
	return `${REDIS_KEY_PREFIX}:v3:${fingerprint}`;
}

export async function getGcpServiceAccountAccessToken(
	serviceAccountJson: string,
	abortSignal?: AbortSignal,
): Promise<string> {
	const sa = parseServiceAccount(serviceAccountJson);
	if (!sa) {
		throw new Error(
			"Invalid GCP service account key — must be valid service account JSON",
		);
	}

	const key = cacheKey(sa);
	const now = Date.now();

	const memEntry = memoryCache.get(key);
	if (memEntry && memEntry.expiresAt > now) {
		return memEntry.token;
	}

	try {
		const raw = await withAbortSignal(redisClient.get(key), abortSignal);
		const cached = raw ? parseCachedToken(raw) : null;
		if (cached && cached.expiresAt > now) {
			memoryCache.set(key, cached);
			return cached.token;
		}
	} catch (err) {
		rethrowAbort(abortSignal);
		logger.warn(
			"Redis read failed for GCP service account token",
			err instanceof Error ? err : new Error(String(err)),
		);
	}

	const entry = await exchangeJwtForAccessToken(sa, abortSignal);
	memoryCache.set(key, entry);
	const ttlSeconds = Math.max(
		Math.floor((entry.expiresAt - Date.now()) / MS_PER_SECOND),
		1,
	);
	try {
		await withAbortSignal(
			redisClient.set(key, JSON.stringify(entry), "EX", ttlSeconds),
			abortSignal,
		);
	} catch (err) {
		rethrowAbort(abortSignal);
		logger.warn(
			"Redis write failed for GCP service account token",
			err instanceof Error ? err : new Error(String(err)),
		);
	}
	return entry.token;
}

export function getGcpServiceAccountProjectId(
	serviceAccountJson: string,
): string | null {
	const sa = parseServiceAccount(serviceAccountJson);
	return sa?.project_id ?? null;
}
