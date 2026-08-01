import { Agent, interceptors, setGlobalDispatcher } from "undici";

import { logger } from "@llmgateway/logger";

import type { Dispatcher } from "undici";

function envInt(name: string, fallback: number): number {
	const value = Number(process.env[name]);
	return Number.isFinite(value) && value >= 0 ? value : fallback;
}

let agent: Agent | null = null;
let prewarmTimer: NodeJS.Timeout | null = null;

function parsePrewarmOrigins(raw: string | undefined): string[] {
	if (!raw) {
		return [];
	}
	const origins: string[] = [];
	for (const entry of raw.split(",")) {
		const trimmed = entry.trim();
		if (!trimmed) {
			continue;
		}
		try {
			origins.push(new URL(trimmed).origin);
		} catch {
			logger.warn("Ignoring invalid UPSTREAM_PREWARM_ORIGINS entry", {
				entry: trimmed,
			});
		}
	}
	return origins;
}

async function prewarmOrigin(origin: string): Promise<void> {
	try {
		const res = await fetch(origin, {
			method: "HEAD",
			redirect: "manual",
			signal: AbortSignal.timeout(5_000),
		});
		await res.body?.cancel();
	} catch {
		// Best-effort: an unreachable prewarm origin must never affect serving.
	}
}

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
 *
 * Both mitigations only help while traffic keeps them warm: after an idle
 * gap the next request still pays the full setup cost. The prewarm pinger
 * closes that hole for the origins that matter — every interval it sends a
 * HEAD request to each origin in UPSTREAM_PREWARM_ORIGINS through this same
 * dispatcher, which keeps at least one pooled connection open and re-resolves
 * DNS on the pinger's time instead of a user request's.
 */
export function installUpstreamDispatcher(): Dispatcher {
	const keepAliveTimeoutMs = envInt("UPSTREAM_KEEPALIVE_TIMEOUT_MS", 60_000);
	const connectTimeoutMs = envInt("UPSTREAM_CONNECT_TIMEOUT_MS", 10_000);
	// Provider API hostnames resolve to CDN/anycast addresses that are stable
	// over minutes, and a connect failure on a stale address is retried by the
	// provider-fallback logic — so a long TTL is safe, while a short one expires
	// between requests on quiet pods and puts DNS back on the TTFT path.
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

	const prewarmOrigins = parsePrewarmOrigins(
		process.env.UPSTREAM_PREWARM_ORIGINS,
	);
	// Must stay below both the local keep-alive timeout and typical provider
	// edge idle timeouts (~60s) so the pooled connection never idles out.
	const prewarmIntervalMs = envInt("UPSTREAM_PREWARM_INTERVAL_MS", 25_000);
	if (prewarmOrigins.length > 0 && prewarmIntervalMs > 0) {
		const prewarmAll = () => {
			for (const origin of prewarmOrigins) {
				void prewarmOrigin(origin);
			}
		};
		prewarmAll();
		prewarmTimer = setInterval(prewarmAll, prewarmIntervalMs);
		prewarmTimer.unref();
	}

	logger.info("Upstream dispatcher installed", {
		keepAliveTimeoutMs,
		connectTimeoutMs,
		dnsCacheTtlMs,
		prewarmOrigins,
		prewarmIntervalMs,
	});
	return dispatcher;
}

export async function closeUpstreamDispatcher(): Promise<void> {
	if (prewarmTimer) {
		clearInterval(prewarmTimer);
		prewarmTimer = null;
	}
	if (agent) {
		await agent.close();
		agent = null;
	}
}
