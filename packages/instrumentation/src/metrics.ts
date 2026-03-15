import { Counter, Gauge, Histogram, Registry } from "prom-client";

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
