import { createHmac } from "node:crypto";

import { logger } from "@llmgateway/logger";
import { getApiKeyHashSecret } from "@llmgateway/shared/api-key-hash";

/**
 * A Vertex API key without a project ID hits the project-less endpoint
 * (`/v1/publishers/google/models/...`), which Google pins to us-central1, so
 * global-only models return "Publisher Model ... was not found". Google names
 * the key's project in that 404, so probing a model that does not exist
 * reveals the project and lets requests use `locations/global` instead.
 */
const VERTEX_PROJECTLESS_PREFIX =
	"https://aiplatform.googleapis.com/v1/publishers/google/models/";
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

export function isProjectlessVertexEndpoint(url: string): boolean {
	return url.startsWith(VERTEX_PROJECTLESS_PREFIX);
}

export function parseVertexProjectFromError(
	message: string,
): string | undefined {
	return /projects\/([a-z0-9-]+)\/locations\//i.exec(message)?.[1];
}

function cacheKey(apiKey: string): string {
	return createHmac("sha256", getApiKeyHashSecret())
		.update(`vertex-api-key-project:${apiKey}`)
		.digest("hex");
}

async function probeVertexApiKeyProject(
	apiKey: string,
	fetchImpl: typeof fetch,
): Promise<string | undefined> {
	try {
		const response = await fetchImpl(
			`${VERTEX_PROJECTLESS_PREFIX}${PROBE_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
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
		const project = parseVertexProjectFromError(await response.text());
		if (!project) {
			logger.warn("Vertex API key project probe returned no project", {
				status: response.status,
			});
		}
		return project;
	} catch (error) {
		logger.warn("Vertex API key project probe failed", {
			error: error instanceof Error ? error.message : String(error),
		});
		return undefined;
	}
}

/**
 * Resolve the Google Cloud project an API key belongs to, cached per process.
 * Returns undefined when it cannot be determined; callers then keep the
 * project-less endpoint.
 */
export async function resolveVertexApiKeyProject(
	apiKey: string,
	fetchImpl: typeof fetch = fetch,
): Promise<string | undefined> {
	const key = cacheKey(apiKey);
	const cached = cache.get(key);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.project;
	}
	const pending = inFlight.get(key);
	if (pending) {
		return await pending;
	}
	const probe = probeVertexApiKeyProject(apiKey, fetchImpl)
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
	if (!apiKey || !isProjectlessVertexEndpoint(url)) {
		return url;
	}
	const project = await resolveVertexApiKeyProject(apiKey, fetchImpl);
	return project ? rebuild(project) : url;
}
