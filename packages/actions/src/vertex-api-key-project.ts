import { createHmac } from "node:crypto";

import { logger } from "@llmgateway/logger";
import { getApiKeyHashSecret } from "@llmgateway/shared/api-key-hash";

/**
 * A Vertex API key without a project ID hits the project-less endpoint
 * (`/v1/publishers/google/models/...`), which does not serve every model the
 * project-scoped endpoint does: newer models return "Publisher Model ... was
 * not found" there. Google names the key's project in that 404, so probing a
 * model that does not exist reveals the project and lets requests use
 * `projects/<n>/locations/global` instead. The probe goes to the same base URL
 * as the request, so pass-through proxies in front of Vertex work too.
 */
const VERTEX_DEFAULT_BASE_URL = "https://aiplatform.googleapis.com";
const VERTEX_PROJECTLESS_PATH = "/v1/publishers/google/models/";
// Regional hosts only serve their own location, not `locations/global`.
const VERTEX_REGIONAL_HOST = /^[a-z0-9-]+-aiplatform\.googleapis\.com$/i;
const PROBE_MODEL = "llmgateway-project-probe";
const PROBE_TIMEOUT_MS = 5000;
const HIT_TTL_MS = 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 10_000;

interface CacheEntry {
	project: string | undefined;
	expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<string | undefined>>();

export function resetVertexApiKeyProjectCache(): void {
	cache.clear();
	inFlight.clear();
}

/**
 * Base URL of a project-less Vertex endpoint, or undefined when the endpoint
 * is project-scoped or on a regional Google host.
 */
export function getProjectlessVertexBaseUrl(url: string): string | undefined {
	const index = url.indexOf(VERTEX_PROJECTLESS_PATH);
	if (index <= 0) {
		return undefined;
	}
	const baseUrl = url.slice(0, index);
	if (!URL.canParse(baseUrl)) {
		return undefined;
	}
	return VERTEX_REGIONAL_HOST.test(new URL(baseUrl).hostname)
		? undefined
		: baseUrl;
}

export function parseVertexProjectFromError(
	message: string,
): string | undefined {
	return /projects\/([a-z0-9-]+)\/locations\//i.exec(message)?.[1];
}

function cacheKey(baseUrl: string, apiKey: string): string {
	// Keyed HMAC for an in-memory cache key, not password storage.
	// lgtm[js/insufficient-password-hash]
	return createHmac("sha256", getApiKeyHashSecret())
		.update(`vertex-api-key-project:${baseUrl}\n${apiKey}`)
		.digest("hex");
}

async function probeVertexApiKeyProject(
	baseUrl: string,
	apiKey: string,
	fetchImpl: typeof fetch,
): Promise<string | undefined> {
	const host = new URL(baseUrl).host;
	try {
		const response = await fetchImpl(
			`${baseUrl}${VERTEX_PROJECTLESS_PATH}${PROBE_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					contents: [{ role: "user", parts: [{ text: "hi" }] }],
				}),
				redirect: "error",
				signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
			},
		);
		const body =
			response.status === 404
				? ((await response.json()) as { error?: { message?: unknown } })
				: undefined;
		const message = body?.error?.message;
		const project =
			typeof message === "string"
				? parseVertexProjectFromError(message)
				: undefined;
		if (!project) {
			logger.warn("Vertex API key project probe returned no project", {
				status: response.status,
				host,
			});
		}
		return project;
	} catch (error) {
		logger.warn("Vertex API key project probe failed", {
			host,
			error: error instanceof Error ? error.message : String(error),
		});
		return undefined;
	}
}

/**
 * Resolve the Google Cloud project an API key belongs to, cached per process
 * and base URL. Returns undefined when it cannot be determined; callers then
 * keep the project-less endpoint.
 */
export async function resolveVertexApiKeyProject(
	apiKey: string,
	fetchImpl: typeof fetch = fetch,
	baseUrl: string = VERTEX_DEFAULT_BASE_URL,
): Promise<string | undefined> {
	const key = cacheKey(baseUrl, apiKey);
	const cached = cache.get(key);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.project;
	}
	const pending = inFlight.get(key);
	if (pending) {
		return await pending;
	}
	const probe = probeVertexApiKeyProject(baseUrl, apiKey, fetchImpl)
		.then((project) => {
			if (cache.size >= MAX_ENTRIES) {
				cache.clear();
			}
			cache.set(key, {
				project,
				expiresAt: Date.now() + (project ? HIT_TTL_MS : MISS_TTL_MS),
			});
			return project;
		})
		.finally(() => inFlight.delete(key));
	inFlight.set(key, probe);
	return await probe;
}

/**
 * Rebuild a project-less Vertex API-key endpoint against the key's project so
 * it uses the global location. Leaves every other endpoint untouched.
 */
export async function routeProjectlessVertexEndpoint(
	url: string,
	apiKey: string | undefined,
	rebuild: (project: string) => string,
	fetchImpl: typeof fetch = fetch,
): Promise<string> {
	const baseUrl = apiKey ? getProjectlessVertexBaseUrl(url) : undefined;
	if (!apiKey || !baseUrl) {
		return url;
	}
	const project = await resolveVertexApiKeyProject(apiKey, fetchImpl, baseUrl);
	return project ? rebuild(project) : url;
}
