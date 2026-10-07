import * as crypto from "node:crypto";

import { redisClient } from "@llmgateway/cache";
import { logger } from "@llmgateway/logger";
import { getApiKeyHashSecret } from "@llmgateway/shared/api-key-hash";

import { fetchNoRedirect } from "./fetch-no-redirect.js";

interface ServiceAccountKey {
	client_email: string;
	private_key: string;
	project_id: string;
}

// Service-account JSON is user-supplied, so its token_uri is ignored: fetching
// it would let a key point the server at internal hosts.
export const GOOGLE_OAUTH_TOKEN_URI = "https://oauth2.googleapis.com/token";

const REDIS_KEY_PREFIX = "gcp:service-account:access_token:v2";
const TTL_SECONDS = 50 * 60;
const TTL_MS = TTL_SECONDS * 1000;
const REDIS_HIT_MEMORY_TTL_MS = 60_000;

interface MemoryCacheEntry {
	token: string;
	expiresAt: number;
}

const memoryCache = new Map<string, MemoryCacheEntry>();

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
): Promise<string> {
	const jwt = signJwt(sa);
	const res = await fetchNoRedirect(GOOGLE_OAUTH_TOKEN_URI, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
			assertion: jwt,
		}),
		signal: abortSignal,
	});

	if (!res.ok) {
		throw new Error(
			`Failed to exchange JWT for GCP access token: ${res.status}`,
		);
	}

	const data = (await res.json()) as { access_token?: string };
	if (!data.access_token) {
		throw new Error("GCP token endpoint returned no access_token");
	}
	return data.access_token;
}

// Keyed by the private key, not just the account name, so a token is only
// served to a caller holding the credential that minted it.
function cacheKey(sa: ServiceAccountKey): string {
	const hash = crypto
		.createHmac("sha256", getApiKeyHashSecret())
		.update(`gcp-sa-token\0${sa.client_email}\0${sa.private_key}`)
		.digest("hex");
	return `${REDIS_KEY_PREFIX}:${hash}`;
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
		const redisToken = await withAbortSignal(redisClient.get(key), abortSignal);
		if (redisToken) {
			// Another replica may have minted this up to TTL_MS ago, so it is kept
			// in memory only briefly rather than for a full fresh lifetime.
			memoryCache.set(key, {
				token: redisToken,
				expiresAt: now + REDIS_HIT_MEMORY_TTL_MS,
			});
			return redisToken;
		}
	} catch (err) {
		rethrowAbort(abortSignal);
		logger.warn(
			"Redis read failed for GCP service account token",
			err instanceof Error ? err : new Error(String(err)),
		);
	}

	const token = await exchangeJwtForAccessToken(sa, abortSignal);
	memoryCache.set(key, { token, expiresAt: now + TTL_MS });
	try {
		await withAbortSignal(
			redisClient.set(key, token, "EX", TTL_SECONDS),
			abortSignal,
		);
	} catch (err) {
		rethrowAbort(abortSignal);
		logger.warn(
			"Redis write failed for GCP service account token",
			err instanceof Error ? err : new Error(String(err)),
		);
	}
	return token;
}

export function getGcpServiceAccountProjectId(
	serviceAccountJson: string,
): string | null {
	const sa = parseServiceAccount(serviceAccountJson);
	return sa?.project_id ?? null;
}
