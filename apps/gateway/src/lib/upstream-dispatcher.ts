import { Agent, interceptors, setGlobalDispatcher } from "undici";

import { logger } from "@llmgateway/logger";

import type { Dispatcher } from "undici";

function envInt(name: string, fallback: number): number {
	const value = Number(process.env[name]);
	return Number.isFinite(value) && value >= 0 ? value : fallback;
}

let agent: Agent | null = null;

/**
 * Installs a tuned undici Agent as the global dispatcher used by `fetch` for
 * all upstream provider requests.
 *
 * Node's default dispatcher closes idle keep-alive sockets after 4 seconds
 * and resolves DNS on every new connection. Streaming responses hold their
 * socket for the whole generation, so under concurrent traffic most requests
 * find no free socket and pay a fresh DNS + TCP + TLS setup to the provider
 * before the first token can arrive — and in Kubernetes an uncached lookup
 * goes through search-domain expansion (ndots:5), where a single dropped UDP
 * packet stalls the request for multiple seconds. A long idle keep-alive plus
 * an in-process DNS cache removes both from the time-to-first-token path.
 */
export function installUpstreamDispatcher(): Dispatcher {
	const keepAliveTimeoutMs = envInt("UPSTREAM_KEEPALIVE_TIMEOUT_MS", 60_000);
	const connectTimeoutMs = envInt("UPSTREAM_CONNECT_TIMEOUT_MS", 10_000);
	// Provider API hostnames resolve to CDN/anycast addresses that are stable
	// over minutes, and a connect failure on a stale address is retried by the
	// provider-fallback logic — so a long TTL is safe, while a short one expires
	// between requests on a quiet pod and puts resolution back on the TTFT path.
	const dnsCacheTtlMs = envInt("UPSTREAM_DNS_CACHE_TTL_MS", 300_000);

	agent = new Agent({
		keepAliveTimeout: keepAliveTimeoutMs,
		connect: { timeout: connectTimeoutMs },
	});

	const dispatcher =
		dnsCacheTtlMs > 0
			? agent.compose(
					interceptors.dns({ maxTTL: dnsCacheTtlMs, maxItems: 512 }),
				)
			: agent;

	setGlobalDispatcher(dispatcher);
	logger.info("Upstream dispatcher installed", {
		keepAliveTimeoutMs,
		connectTimeoutMs,
		dnsCacheTtlMs,
	});
	return dispatcher;
}

export async function closeUpstreamDispatcher(): Promise<void> {
	if (agent) {
		await agent.close();
		agent = null;
	}
}
