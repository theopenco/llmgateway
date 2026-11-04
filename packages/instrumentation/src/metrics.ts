import { createServer, type Server } from "node:http";

import { Counter, Gauge, Histogram, Registry } from "prom-client";

import { logger } from "@llmgateway/logger";

// Create a dedicated registry to avoid conflicts with default metrics
export const metricsRegistry = new Registry();

// Set default labels for all metrics
metricsRegistry.setDefaultLabels({
	service: "llmgateway-gateway",
});

// Counter for total chat completion requests
export const chatCompletionsTotal = new Counter({
	name: "chat_completions_total",
	help: "Total number of chat completion requests",
	labelNames: ["model", "provider", "finish_reason", "streaming"] as const,
	registers: [metricsRegistry],
});

// Histogram for request duration (in seconds)
export const chatCompletionDuration = new Histogram({
	name: "chat_completion_duration_seconds",
	help: "Duration of chat completion requests in seconds",
	labelNames: ["model", "provider", "streaming"] as const,
	buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300],
	registers: [metricsRegistry],
});

// Histogram for time to first token (streaming requests only, in milliseconds)
export const timeToFirstToken = new Histogram({
	name: "chat_completion_ttft_ms",
	help: "Time to first token for streaming chat completion requests in milliseconds",
	labelNames: ["model", "provider"] as const,
	buckets: [50, 100, 200, 500, 1000, 2000, 5000, 10000],
	registers: [metricsRegistry],
});

// Counter for errors by type
export const chatCompletionErrors = new Counter({
	name: "chat_completion_errors_total",
	help: "Total number of chat completion errors",
	labelNames: ["model", "provider", "error_type"] as const,
	registers: [metricsRegistry],
});

// Counter for finish reasons
export const finishReasonTotal = new Counter({
	name: "chat_completion_finish_reason_total",
	help: "Total number of chat completions by finish reason",
	labelNames: ["model", "provider", "finish_reason"] as const,
	registers: [metricsRegistry],
});

// Histogram for token usage
export const tokenUsage = new Histogram({
	name: "chat_completion_tokens",
	help: "Token usage for chat completion requests",
	labelNames: ["model", "provider", "token_type"] as const,
	buckets: [10, 50, 100, 500, 1000, 5000, 10000, 50000, 100000],
	registers: [metricsRegistry],
});

// Gauge for tracking concurrent in-flight requests
export const requestsInFlight = new Gauge({
	name: "chat_completion_requests_in_flight",
	help: "Number of chat completion requests currently being processed",
	labelNames: ["model", "provider"] as const,
	registers: [metricsRegistry],
});

// Gauge for tracking in-flight inference requests across the whole gateway pod
// (used by the backpressure middleware to shed load above a configured cap).
// Only inference endpoints are counted; cheap metadata routes are exempt.
export const gatewayInflightRequests = new Gauge({
	name: "gateway_inflight_requests",
	help: "Number of inference requests currently in flight on this gateway pod",
	registers: [metricsRegistry],
});

// Counter for requests shed by a concurrency limit. scope="pod" is the
export const managedKeySelectionsTotal = new Counter({
	name: "managed_key_selections_total",
	help: "Managed credential selections by strategy and initial or retry attempt",
	labelNames: ["strategy", "attempt"] as const,
	registers: [metricsRegistry],
});

export const managedKeySelectionDegradedTotal = new Counter({
	name: "managed_key_selection_degraded_total",
	help: "Round-robin selections degraded to ordered keys after cursor errors",
	registers: [metricsRegistry],
});
// pod-wide backpressure cap (HTTP 529); scope="org" is a per-organization
// in-flight limit (HTTP 429). Lets us alert on dropped traffic and see how
// often limits are hit, rather than inferring it from the gauge riding the cap.
export const gatewayRequestsShedTotal = new Counter({
	name: "gateway_requests_shed_total",
	help: "Total number of requests shed due to an in-flight concurrency cap",
	labelNames: ["scope"] as const,
	registers: [metricsRegistry],
});

// Requests whose client IP could not be read from CLIENT_IP_HEADER. Only
// in-cluster probes should ever land here, so a rise means a route stopped
// stamping the header or its name no longer matches the load balancer — the
// failure that silently collapses every per-IP limit into one bucket.
export const clientIpMissingTotal = new Counter({
	name: "client_ip_missing_total",
	help: "Total number of requests with no resolvable client IP",
	labelNames: ["service"] as const,
	registers: [metricsRegistry],
});

export interface ChatCompletionMetrics {
	model: string;
	provider: string;
	finishReason: string | null;
	streaming: boolean;
	durationMs: number;
	ttftMs?: number;
	inputTokens?: number;
	outputTokens?: number;
	reasoningTokens?: number;
	cachedTokens?: number;
	errorType?: string;
}

/**
 * Record metrics for a completed chat completion request
 */
export function recordChatCompletionMetrics(metrics: ChatCompletionMetrics) {
	const {
		model,
		provider,
		finishReason,
		streaming,
		durationMs,
		ttftMs,
		inputTokens,
		outputTokens,
		reasoningTokens,
		cachedTokens,
		errorType,
	} = metrics;

	const normalizedFinishReason = finishReason ?? "unknown";
	const streamingLabel = streaming ? "true" : "false";

	// Increment total request counter
	chatCompletionsTotal
		.labels(model, provider, normalizedFinishReason, streamingLabel)
		.inc();

	// Record duration
	chatCompletionDuration
		.labels(model, provider, streamingLabel)
		.observe(durationMs / 1000);

	// Record TTFT for streaming requests
	if (streaming && ttftMs !== undefined && ttftMs > 0) {
		timeToFirstToken.labels(model, provider).observe(ttftMs);
	}

	// Record finish reason
	if (finishReason) {
		finishReasonTotal.labels(model, provider, normalizedFinishReason).inc();
	}

	// Record errors
	if (errorType) {
		chatCompletionErrors.labels(model, provider, errorType).inc();
	}

	// Record token usage
	if (inputTokens !== undefined && inputTokens > 0) {
		tokenUsage.labels(model, provider, "input").observe(inputTokens);
	}
	if (outputTokens !== undefined && outputTokens > 0) {
		tokenUsage.labels(model, provider, "output").observe(outputTokens);
	}
	if (reasoningTokens !== undefined && reasoningTokens > 0) {
		tokenUsage.labels(model, provider, "reasoning").observe(reasoningTokens);
	}
	if (cachedTokens !== undefined && cachedTokens > 0) {
		tokenUsage.labels(model, provider, "cached").observe(cachedTokens);
	}
}

/**
 * Record that a request has started (for tracking in-flight requests)
 */
export function recordRequestStarted(model: string, provider: string) {
	requestsInFlight.labels(model, provider).inc();
}

/**
 * Record that a request has completed (for tracking in-flight requests)
 */
export function recordRequestCompleted(model: string, provider: string) {
	requestsInFlight.labels(model, provider).dec();
}

/**
 * Get metrics in Prometheus exposition format
 */
export async function getMetrics(): Promise<string> {
	return await metricsRegistry.metrics();
}

/**
 * Get the content type for Prometheus metrics
 */
export function getMetricsContentType(): string {
	return metricsRegistry.contentType;
}

/** Labels every metric with the emitting service (default: the gateway). */
export function setMetricsServiceName(service: string): void {
	metricsRegistry.setDefaultLabels({ service });
}

export interface DbPoolStats {
	total: number;
	idle: number;
	waiting: number;
	max: number;
}

let dbPoolMetricsRegistered = false;

/**
 * Exports the shared pg pool's occupancy, read at scrape time. Saturation
 * (active == max) with waiting clients is the early signal of a lock pile-up:
 * queries queue behind a blocked statement long before Postgres runs out of
 * connection slots.
 */
export function registerDbPoolMetrics(getStats: () => DbPoolStats): void {
	if (dbPoolMetricsRegistered) {
		return;
	}
	dbPoolMetricsRegistered = true;

	const gauges = [
		new Gauge({
			name: "db_pool_connections",
			help: "Connections in the database pool by state (total, idle, active)",
			labelNames: ["state"] as const,
			registers: [],
			collect() {
				const stats = getStats();
				this.set({ state: "total" }, stats.total);
				this.set({ state: "idle" }, stats.idle);
				this.set({ state: "active" }, stats.total - stats.idle);
			},
		}),
		new Gauge({
			name: "db_pool_waiting_clients",
			help: "Queries waiting for a free database pool connection",
			registers: [],
			collect() {
				this.set(getStats().waiting);
			},
		}),
		new Gauge({
			name: "db_pool_max_connections",
			help: "Configured database pool size",
			registers: [],
			collect() {
				this.set(getStats().max);
			},
		}),
		new Gauge({
			name: "db_pool_utilization_ratio",
			help: "Active database pool connections divided by the pool size",
			registers: [],
			collect() {
				const stats = getStats();
				this.set(stats.max > 0 ? (stats.total - stats.idle) / stats.max : 0);
			},
		}),
	];
	for (const gauge of gauges) {
		metricsRegistry.registerMetric(gauge);
	}
}

/**
 * Serves `GET /metrics` on its own port, for services without an HTTP app of
 * their own (the worker) or that keep metrics off their public port (the API).
 */
export function startMetricsServer(port: number): Server {
	const server = createServer((req, res) => {
		if (req.method !== "GET" || req.url !== "/metrics") {
			res.writeHead(404).end();
			return;
		}
		metricsRegistry.metrics().then(
			(body) => {
				res.writeHead(200, { "Content-Type": metricsRegistry.contentType });
				res.end(body);
			},
			(error: unknown) => {
				logger.error(
					"Failed to collect metrics",
					error instanceof Error ? error : new Error(String(error)),
				);
				res.writeHead(500).end();
			},
		);
	});
	server.listen(port);
	return server;
}
