import * as crypto from "node:crypto";

import { redisClient } from "@llmgateway/cache";
import { logger } from "@llmgateway/logger";
import {
	type EnvVarVariant,
	getVariantEnvVarNameFor,
} from "@llmgateway/models";

interface ServiceAccountKey {
	client_email: string;
	private_key: string;
	token_uri: string;
	project_id: string;
}

const BASE_ENV_VAR = "LLM_VERTEX_ANTHROPIC_SERVICE_ACCOUNT_JSON";
const REDIS_KEY = "gcp:vertex-anthropic:access_token";
const TTL_SECONDS = 50 * 60;
const TTL_MS = TTL_SECONDS * 1000;

// Caches are keyed by the resolved env var name so enterprise/plans variant
// credentials never share tokens with the base credential.
const memoryCache = new Map<string, { token: string; expiresAt: number }>();

const serviceAccountKeys = new Map<string, ServiceAccountKey>();

function resolveEnvVarName(variant?: EnvVarVariant): string {
	return getVariantEnvVarNameFor(BASE_ENV_VAR, variant) ?? BASE_ENV_VAR;
}

function getServiceAccountKey(
	variant?: EnvVarVariant,
): ServiceAccountKey | null {
	const envVarName = resolveEnvVarName(variant);
	const cached = serviceAccountKeys.get(envVarName);
	if (cached) {
		return cached;
	}

	const inlineJson = process.env[envVarName];
	if (!inlineJson) {
		return null;
	}

	try {
		const parsed = JSON.parse(inlineJson) as ServiceAccountKey;
		serviceAccountKeys.set(envVarName, parsed);
		return parsed;
	} catch (err) {
		logger.error(`Failed to parse ${envVarName}`, err);
		return null;
	}
}

export function getVertexAnthropicProjectId(
	variant?: EnvVarVariant,
): string | null {
	const sa = getServiceAccountKey(variant);
	return sa?.project_id ?? null;
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

export async function getGcpAccessToken(
	variant?: EnvVarVariant,
): Promise<string | null> {
	const envVarName = resolveEnvVarName(variant);
	const sa = getServiceAccountKey(variant);
	if (!sa) {
		return null;
	}

	const redisKey =
		envVarName === BASE_ENV_VAR ? REDIS_KEY : `${REDIS_KEY}:${envVarName}`;

	const memoryCached = memoryCache.get(envVarName);
	if (memoryCached && memoryCached.expiresAt > Date.now()) {
		return memoryCached.token;
	}

	try {
		const cached = await redisClient.get(redisKey);
		if (cached) {
			memoryCache.set(envVarName, {
				token: cached,
				expiresAt: Date.now() + 60_000,
			});
			return cached;
		}
	} catch (err) {
		logger.debug(
			"Redis unavailable for token cache read",
			err instanceof Error ? err : new Error(String(err)),
		);
	}

	const token = await fetchNewToken(sa);

	try {
		await redisClient.set(redisKey, token, "EX", TTL_SECONDS);
	} catch (err) {
		logger.debug(
			"Redis unavailable for token cache write",
			err instanceof Error ? err : new Error(String(err)),
		);
	}

	memoryCache.set(envVarName, { token, expiresAt: Date.now() + TTL_MS });
	return token;
}
