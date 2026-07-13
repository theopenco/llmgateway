import * as crypto from "node:crypto";

import { redisClient } from "@llmgateway/cache";
import { logger } from "@llmgateway/logger";

interface ServiceAccountKey {
	client_email: string;
	private_key: string;
	token_uri: string;
	project_id: string;
}

const REDIS_KEY_PREFIX = "gcp:vertex-openai:access_token";
const TTL_SECONDS = 50 * 60;
const TTL_MS = TTL_SECONDS * 1000;

interface MemoryCacheEntry {
	token: string;
	expiresAt: number;
}

const memoryCache = new Map<string, MemoryCacheEntry>();

function base64url(data: Buffer | string): string {
	const buf = typeof data === "string" ? Buffer.from(data) : data;
	return buf.toString("base64url");
}

function parseServiceAccount(json: string): ServiceAccountKey | null {
	try {
		return JSON.parse(json) as ServiceAccountKey;
	} catch (err) {
		logger.error(
			"Failed to parse Vertex OpenAI service account JSON",
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
		aud: sa.token_uri,
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
): Promise<string> {
	const jwt = signJwt(sa);
	const res = await fetch(sa.token_uri, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
			assertion: jwt,
		}),
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(
			`Failed to exchange JWT for GCP access token: ${res.status} ${text}`,
		);
	}

	const data = (await res.json()) as { access_token?: string };
	if (!data.access_token) {
		throw new Error("GCP token endpoint returned no access_token");
	}
	return data.access_token;
}

function cacheKey(sa: ServiceAccountKey): string {
	const hash = crypto
		.createHash("sha256")
		.update(sa.client_email + "|" + sa.token_uri)
		.digest("hex")
		.slice(0, 16);
	return `${REDIS_KEY_PREFIX}:${hash}`;
}

export async function getVertexOpenAIAccessToken(
	serviceAccountJson: string,
): Promise<string> {
	const sa = parseServiceAccount(serviceAccountJson);
	if (!sa) {
		throw new Error(
			"Invalid LLM_VERTEX_OPENAI_SERVICE_ACCOUNT_JSON — must be valid service account JSON",
		);
	}

	const key = cacheKey(sa);
	const now = Date.now();

	const memEntry = memoryCache.get(key);
	if (memEntry && memEntry.expiresAt > now) {
		return memEntry.token;
	}

	try {
		const redisToken = await redisClient.get(key);
		if (redisToken) {
			memoryCache.set(key, { token: redisToken, expiresAt: now + TTL_MS });
			return redisToken;
		}
	} catch (err) {
		logger.warn(
			"Redis read failed for Vertex OpenAI token",
			err instanceof Error ? err : new Error(String(err)),
		);
	}

	const token = await exchangeJwtForAccessToken(sa);
	memoryCache.set(key, { token, expiresAt: now + TTL_MS });
	try {
		await redisClient.set(key, token, "EX", TTL_SECONDS);
	} catch (err) {
		logger.warn(
			"Redis write failed for Vertex OpenAI token",
			err instanceof Error ? err : new Error(String(err)),
		);
	}
	return token;
}

export function getVertexOpenAIProjectId(
	serviceAccountJson: string,
): string | null {
	const sa = parseServiceAccount(serviceAccountJson);
	return sa?.project_id ?? null;
}
