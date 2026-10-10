import {
	Agent,
	Dispatcher1Wrapper,
	interceptors,
	setGlobalDispatcher,
} from "undici";

import { getGatewayTimeoutMs } from "@/lib/timeout-config.js";

import { logger } from "@llmgateway/logger";
import { safeOutboundLookup } from "@llmgateway/shared/url-safety-node";

import type { Dispatcher } from "undici";

function envInt(name: string, fallback: number): number {
	const value = Number(process.env[name]);
	return Number.isFinite(value) && value >= 0 ? value : fallback;
}

// undici defaults headersTimeout and bodyTimeout to 300s, which would cut off
// provider calls before the longer plain/streaming request timeouts fire. Cap
// them at the overall gateway timeout so those timers stay in charge.
function responseTimeouts() {
	const timeoutMs = getGatewayTimeoutMs();
	return { headersTimeout: timeoutMs, bodyTimeout: timeoutMs };
}

let agent: Agent | null = null;
let tenantAgent: Agent | null = null;
let tenantDispatcher: Dispatcher | null = null;

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
		...responseTimeouts(),
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

/**
 * Dispatcher for tenant-supplied base URLs (BYOK, custom providers, Airside
 * carriers). Those URLs are checked at registration, but DNS can be repointed
 * afterwards, so every connection re-checks the resolved address. It skips the
 * shared DNS cache, which would otherwise answer from an unchecked lookup.
 */
export function getTenantUpstreamDispatcher(): Dispatcher {
	if (!tenantDispatcher) {
		tenantAgent = new Agent({
			...responseTimeouts(),
			keepAliveTimeout: envInt("UPSTREAM_KEEPALIVE_TIMEOUT_MS", 60_000),
			connect: {
				timeout: envInt("UPSTREAM_CONNECT_TIMEOUT_MS", 10_000),
				lookup: safeOutboundLookup,
			},
		});
		// Passed to the built-in fetch, whose bundled undici may predate v8's
		// handler API (Node 24 fails with "invalid onRequestStart method").
		tenantDispatcher = new Dispatcher1Wrapper(tenantAgent);
	}
	return tenantDispatcher;
}

export async function closeUpstreamDispatcher(): Promise<void> {
	if (agent) {
		await agent.close();
		agent = null;
	}
	if (tenantAgent) {
		await tenantAgent.close();
		tenantAgent = null;
		tenantDispatcher = null;
	}
}
