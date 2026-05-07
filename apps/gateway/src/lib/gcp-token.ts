import * as crypto from "node:crypto";
import * as fs from "node:fs";

import { redisClient } from "@llmgateway/cache";
import { logger } from "@llmgateway/logger";

interface ServiceAccountKey {
	client_email: string;
	private_key: string;
	token_uri: string;
}

const REDIS_KEY = "gcp:vertex:access_token";
const TTL_SECONDS = 50 * 60;

let memoryCache: { token: string; expiresAt: number } | null = null;

let serviceAccountKey: ServiceAccountKey | null = null;

function getServiceAccountKey(): ServiceAccountKey | null {
	if (serviceAccountKey) {
		return serviceAccountKey;
	}

	const keyFile = process.env.GCP_SERVICE_ACCOUNT_KEY_FILE;
	if (!keyFile) {
		return null;
	}

	try {
		const content = fs.readFileSync(keyFile, "utf-8");
		serviceAccountKey = JSON.parse(content) as ServiceAccountKey;
		return serviceAccountKey;
	} catch (err) {
		logger.error("Failed to read GCP service account key file", err);
		return null;
	}
}

function base64url(data: Buffer | string): string {
	const buf = typeof data === "string" ? Buffer.from(data) : data;
	return buf.toString("base64url");
}

function createSignedJwt(sa: ServiceAccountKey, scope: string): string {
	const now = Math.floor(Date.now() / 1000);
	const header = { alg: "RS256", typ: "JWT" };
	const payload = {
		iss: sa.client_email,
		scope,
		aud: sa.token_uri,
		iat: now,
		exp: now + 3600,
	};

	const segments = [
		base64url(JSON.stringify(header)),
		base64url(JSON.stringify(payload)),
	];
	const signingInput = segments.join(".");

	const sign = crypto.createSign("RSA-SHA256");
	sign.update(signingInput);
	const signature = sign.sign(sa.private_key);

	return `${signingInput}.${base64url(signature)}`;
}

async function fetchNewToken(sa: ServiceAccountKey): Promise<string> {
	const scope = "https://www.googleapis.com/auth/cloud-platform";
	const jwt = createSignedJwt(sa, scope);

	const body = new URLSearchParams({
		grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
		assertion: jwt,
	});

	const res = await fetch(sa.token_uri, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: body.toString(),
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`GCP token exchange failed (${res.status}): ${text}`);
	}

	const data = (await res.json()) as { access_token: string };
	return data.access_token;
}

export async function getGcpAccessToken(): Promise<string | null> {
	const sa = getServiceAccountKey();
	if (!sa) {
		return null;
	}

	// Check in-memory cache first (fast path, avoids Redis round-trip)
	if (memoryCache && memoryCache.expiresAt > Date.now()) {
		return memoryCache.token;
	}

	// Try Redis cache (shared across instances)
	try {
		const cached = await redisClient.get(REDIS_KEY);
		if (cached) {
			memoryCache = { token: cached, expiresAt: Date.now() + 60_000 };
			return cached;
		}
	} catch {
		// Redis unavailable — continue to generate token
	}

	const token = await fetchNewToken(sa);

	// Store in Redis with 50-minute TTL
	try {
		await redisClient.set(REDIS_KEY, token, "EX", TTL_SECONDS);
	} catch {
		// Redis unavailable — in-memory cache still works
	}

	memoryCache = { token, expiresAt: Date.now() + TTL_SECONDS * 1000 };
	return token;
}
