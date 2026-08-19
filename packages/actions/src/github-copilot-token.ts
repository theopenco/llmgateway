import * as crypto from "node:crypto";

import { redisClient } from "@llmgateway/cache";
import { logger } from "@llmgateway/logger";

const DEFAULT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";

const REDIS_KEY_PREFIX = "github-copilot:api_token";
// Copilot API tokens are short-lived (~30 minutes). The exchange response
// carries the exact expiry; this is the fallback when it is missing, and the
// safety margin subtracted so a cached token is never used right at its edge.
const FALLBACK_TTL_SECONDS = 20 * 60;
const EXPIRY_MARGIN_SECONDS = 60;

/**
 * Headers GitHub requires on Copilot API calls. The Copilot API only serves
 * registered integrations, so requests identify as the VS Code Copilot Chat
 * integration — the same approach used by LiteLLM's github_copilot provider
 * and other Copilot-compatible proxies.
 */
export const GITHUB_COPILOT_HEADERS: Record<string, string> = {
	"Copilot-Integration-Id": "vscode-chat",
	"Editor-Version": "vscode/1.103.0",
	"Editor-Plugin-Version": "copilot-chat/0.29.1",
	"User-Agent": "GitHubCopilotChat/0.29.1",
};

interface MemoryCacheEntry {
	token: string;
	expiresAt: number;
}

const memoryCache = new Map<string, MemoryCacheEntry>();

// Bound the per-process cache: expired entries otherwise accumulate for every
// OAuth token ever seen (token rotations, key churn) until process exit.
const MEMORY_CACHE_MAX_ENTRIES = 1000;

function pruneMemoryCache(now: number): void {
	if (memoryCache.size < MEMORY_CACHE_MAX_ENTRIES) {
		return;
	}
	for (const [key, entry] of memoryCache) {
		if (entry.expiresAt <= now) {
			memoryCache.delete(key);
		}
	}
	// Still at the cap (many live tokens): evict oldest insertions.
	while (memoryCache.size >= MEMORY_CACHE_MAX_ENTRIES) {
		const oldest = memoryCache.keys().next().value;
		if (oldest === undefined) {
			break;
		}
		memoryCache.delete(oldest);
	}
}

function cacheKey(githubToken: string): string {
	const hash = crypto
		.createHash("sha256")
		.update(githubToken)
		.digest("hex")
		.slice(0, 16);
	return `${REDIS_KEY_PREFIX}:${hash}`;
}

async function exchangeGithubToken(
	githubToken: string,
): Promise<{ token: string; ttlSeconds: number }> {
	const tokenUrl =
		process.env.LLM_GITHUB_COPILOT_TOKEN_URL || DEFAULT_TOKEN_URL;
	const res = await fetch(tokenUrl, {
		method: "GET",
		redirect: "error",
		// Bounded so a stalled GitHub endpoint fails the request instead of
		// hanging key validation or an in-flight gateway request indefinitely.
		signal: AbortSignal.timeout(15_000),
		headers: {
			Authorization: `token ${githubToken}`,
			Accept: "application/json",
			...GITHUB_COPILOT_HEADERS,
		},
	});

	if (!res.ok) {
		const text = await res.text();
		if (res.status === 401 || res.status === 403) {
			throw new Error(
				`GitHub Copilot token exchange failed (${res.status}): the GitHub token is invalid, expired, or the account has no active Copilot subscription. ${text}`,
			);
		}
		throw new Error(
			`GitHub Copilot token exchange failed: ${res.status} ${text}`,
		);
	}

	const data = (await res.json()) as {
		token?: string;
		expires_at?: number;
	};
	if (!data.token) {
		throw new Error("GitHub Copilot token endpoint returned no token");
	}

	const nowSeconds = Math.floor(Date.now() / 1000);
	const ttlSeconds =
		data.expires_at && data.expires_at > nowSeconds
			? Math.max(data.expires_at - nowSeconds - EXPIRY_MARGIN_SECONDS, 60)
			: FALLBACK_TTL_SECONDS;
	return { token: data.token, ttlSeconds };
}

/**
 * Exchange a long-lived GitHub OAuth token (the stored provider-key
 * credential) for the short-lived Copilot API bearer token that travels in
 * the Authorization header. Cached in Redis and in-process until shortly
 * before the upstream expiry.
 */
export async function getGithubCopilotToken(
	githubToken: string,
): Promise<string> {
	const key = cacheKey(githubToken);
	const now = Date.now();

	const memEntry = memoryCache.get(key);
	if (memEntry && memEntry.expiresAt > now) {
		return memEntry.token;
	}

	try {
		const redisEntry = await redisClient.get(key);
		if (redisEntry) {
			const redisTtl = await redisClient.ttl(key);
			const redisTtlMs = redisTtl * 1000;
			const expiresAt = redisTtl > 0 ? now + redisTtlMs : now + 60_000;
			pruneMemoryCache(now);
			memoryCache.set(key, {
				token: redisEntry,
				expiresAt,
			});
			return redisEntry;
		}
	} catch (err) {
		logger.warn(
			"Redis read failed for GitHub Copilot token",
			err instanceof Error ? err : new Error(String(err)),
		);
	}

	const { token, ttlSeconds } = await exchangeGithubToken(githubToken);
	const ttlMs = ttlSeconds * 1000;
	pruneMemoryCache(now);
	memoryCache.set(key, { token, expiresAt: now + ttlMs });
	try {
		await redisClient.set(key, token, "EX", ttlSeconds);
	} catch (err) {
		logger.warn(
			"Redis write failed for GitHub Copilot token",
			err instanceof Error ? err : new Error(String(err)),
		);
	}
	return token;
}
