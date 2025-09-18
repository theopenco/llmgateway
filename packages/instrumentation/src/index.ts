import { TraceExporter } from "@google-cloud/opentelemetry-cloud-trace-exporter";
import { CloudPropagator } from "@google-cloud/opentelemetry-cloud-trace-propagator";
import { trace } from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { CompositePropagator } from "@opentelemetry/core";
import {
	W3CTraceContextPropagator,
	W3CBaggagePropagator,
} from "@opentelemetry/core";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
	AlwaysOnSampler,
	BatchSpanProcessor,
	TraceIdRatioBasedSampler,
	SamplingDecision,
} from "@opentelemetry/sdk-trace-base";

import { createLogger } from "@llmgateway/logger";

import type { Attributes, Context, SpanKind, Link } from "@opentelemetry/api";
import type { Sampler, SamplingResult } from "@opentelemetry/sdk-trace-base";

const logger = createLogger({ name: "instrumentation" });

// Error detection patterns (hoisted to avoid per-call allocation)
const ERROR_NAME_PATTERNS = [
	/error/i,
	/exception/i,
	/fail/i,
	/timeout/i,
	/abort/i,
];

class HeaderBasedForceSampler implements Sampler {
	private fallbackSampler: Sampler;

	public constructor(fallbackSampler: Sampler) {
		this.fallbackSampler = fallbackSampler;
	}

	public shouldSample(
		context: Context,
		traceId: string,
		spanName: string,
		spanKind: SpanKind,
		attributes: Attributes,
		links: Link[],
	): SamplingResult {
		// Check if force-trace header is present in the attributes
		// The header should be set as an attribute by the middleware
		if (attributes && attributes["http.header.x-force-trace"]) {
			const forceTrace = attributes["http.header.x-force-trace"];
			if (forceTrace === "true" || forceTrace === "1") {
				return {
					decision: SamplingDecision.RECORD_AND_SAMPLED,
					attributes: {
						...attributes,
						"sampling.forced": true,
					},
				};
			}
		}

		// Fall back to the configured sampler
		return this.fallbackSampler.shouldSample(
			context,
			traceId,
			spanName,
			spanKind,
			attributes,
			links,
		);
	}

	public toString(): string {
		return `HeaderBasedForceSampler{fallback=${this.fallbackSampler.toString()}}`;
	}
}

class ErrorAwareSampler implements Sampler {
	private normalSampler: Sampler;
	private errorSampler: Sampler;

	public constructor(normalSampler: Sampler, errorSampler: Sampler) {
		this.normalSampler = normalSampler;
		this.errorSampler = errorSampler;
	}

	public shouldSample(
		context: Context,
		traceId: string,
		spanName: string,
		spanKind: SpanKind,
		attributes: Attributes,
		links: Link[],
	): SamplingResult {
		// Check if this span is likely to be an error span based on attributes
		// This is a heuristic approach since we can't know the final status at sampling time
		const isLikelyError = this.isLikelyErrorSpan(attributes, spanName);

		const sampler = isLikelyError ? this.errorSampler : this.normalSampler;
		const result = sampler.shouldSample(
			context,
			traceId,
			spanName,
			spanKind,
			attributes,
			links,
		);

		// Add metadata to indicate which sampling strategy was used
		if (result.decision === SamplingDecision.RECORD_AND_SAMPLED) {
			return {
				...result,
				attributes: {
					...result.attributes,
					"sampling.strategy": isLikelyError ? "error" : "normal",
				},
			};
		}

		return result;
	}

	private isLikelyErrorSpan(attributes: Attributes, spanName: string): boolean {
		// Check for HTTP error status codes
		const httpStatus = attributes["http.status_code"];
		if (httpStatus && typeof httpStatus === "number" && httpStatus >= 400) {
			return true;
		}

		// Check for likely error indicator set by middleware
		if (attributes["sampling.likely_error"]) {
			return true;
		}

		// Check for error-related span names
		return ERROR_NAME_PATTERNS.some((pattern) => pattern.test(spanName));
	}

	public toString(): string {
		return `ErrorAwareSampler{normal=${this.normalSampler.toString()}, error=${this.errorSampler.toString()}}`;
	}
}

function getSamplerConfig() {
	const sampleRate = process.env.OTEL_SAMPLE_RATE;
	const errorSampleRate = process.env.OTEL_ERROR_SAMPLE_RATE;

	// Create normal sampler
	let normalSampler: Sampler;
	let normalDescription: string;

	if (sampleRate === undefined) {
		normalSampler = new AlwaysOnSampler();
		normalDescription = "100% (always on)";
	} else {
		const rate = parseFloat(sampleRate);
		if (isNaN(rate) || rate < 0 || rate > 1) {
			logger.warn(
				`Invalid OTEL_SAMPLE_RATE value "${sampleRate}", using 100% sampling`,
			);
			normalSampler = new AlwaysOnSampler();
			normalDescription = "100% (always on, invalid rate specified)";
		} else if (rate === 1) {
			normalSampler = new AlwaysOnSampler();
			normalDescription = "100% (always on)";
		} else if (rate === 0) {
			normalSampler = new TraceIdRatioBasedSampler(rate);
			normalDescription = "0% (never sample)";
		} else {
			normalSampler = new TraceIdRatioBasedSampler(rate);
			normalDescription = `${Math.round(rate * 100)}% (ratio-based)`;
		}
	}

	// Create error sampler
	let errorSampler: Sampler;
	let errorDescription: string;

	if (errorSampleRate === undefined) {
		// Default to same as normal sampling if not specified
		errorSampler = normalSampler;
		errorDescription = normalDescription;
	} else {
		const rate = parseFloat(errorSampleRate);
		if (isNaN(rate) || rate < 0 || rate > 1) {
			logger.warn(
				`Invalid OTEL_ERROR_SAMPLE_RATE value "${errorSampleRate}", using normal sampling rate for errors`,
			);
			errorSampler = normalSampler;
			errorDescription = `${normalDescription} (invalid error rate specified)`;
		} else if (rate === 1) {
			errorSampler = new AlwaysOnSampler();
			errorDescription = "100% (always on)";
		} else if (rate === 0) {
			errorSampler = new TraceIdRatioBasedSampler(rate);
			errorDescription = "0% (never sample)";
		} else {
			errorSampler = new TraceIdRatioBasedSampler(rate);
			errorDescription = `${Math.round(rate * 100)}% (ratio-based)`;
		}
	}

	// Create error-aware sampler if error rate is different from normal rate
	let baseSampler: Sampler;
	let baseDescription: string;

	if (errorSampleRate !== undefined && errorSampleRate !== sampleRate) {
		baseSampler = new ErrorAwareSampler(normalSampler, errorSampler);
		baseDescription = `Normal: ${normalDescription}, Errors: ${errorDescription}`;
	} else {
		baseSampler = normalSampler;
		baseDescription = normalDescription;
	}

	// Wrap with header-based force sampler
	const sampler = new HeaderBasedForceSampler(baseSampler);
	const description = `${baseDescription} + header-based force sampling`;

	return {
		sampler,
		description,
	};
}

export interface InstrumentationConfig {
	serviceName: string;
	projectId?: string;
}

export async function initializeInstrumentation(
	config: InstrumentationConfig,
): Promise<NodeSDK> {
	const projectId = config.projectId || process.env.GOOGLE_CLOUD_PROJECT;

	// Use Google Cloud Trace exporter for direct integration
	const traceExporter = new TraceExporter({
		projectId,
	});

	// Use BatchSpanProcessor as recommended by Google Cloud documentation
	const spanProcessor = new BatchSpanProcessor(traceExporter);

	const { sampler, description: samplingDescription } = getSamplerConfig();

	// Configure composite propagator to support both W3C and Google Cloud formats
	const propagator = new CompositePropagator({
		propagators: [
			new CloudPropagator(),
			new W3CTraceContextPropagator(),
			new W3CBaggagePropagator(),
		],
	});

	const sdk = new NodeSDK({
		spanProcessors: [spanProcessor],
		sampler,
		serviceName: config.serviceName,
		textMapPropagator: propagator,
		instrumentations: [
			getNodeAutoInstrumentations({
				"@opentelemetry/instrumentation-fs": {
					enabled: false,
				},
			}),
		],
	});

	try {
		await sdk.start();
		logger.info(
			`OpenTelemetry started successfully for project: ${projectId || "(not set)"}, service: ${config.serviceName}`,
		);
		logger.info(`Tracing configuration`, {
			projectId,
			serviceName: config.serviceName,
			samplingDescription,
			exporter: "Google Cloud Trace",
			processor: "BatchSpanProcessor",
			propagators: ["Google Cloud Trace", "W3C Trace Context", "W3C Baggage"],
		});

		// Validate authentication
		if (!projectId && process.env.NODE_ENV === "production") {
			logger.warn("⚠️  GOOGLE_CLOUD_PROJECT not set - traces may not export");
		}
	} catch (error) {
		logger.error("❌ Error initializing OpenTelemetry SDK:", error as Error);
		logger.error("Troubleshooting steps:");
		logger.error("1. Set GOOGLE_CLOUD_PROJECT environment variable");
		logger.error("2. Ensure Cloud Trace API is enabled");
		logger.error("3. Verify service account has Trace Agent role");
		logger.error("4. Check GOOGLE_APPLICATION_CREDENTIALS is set");
		throw error;
	}

	return sdk;
}

export async function shutdownInstrumentation(sdk: NodeSDK): Promise<void> {
	try {
		logger.info("Shutting down OpenTelemetry SDK");
		await sdk.shutdown();
		logger.info("OpenTelemetry SDK shut down successfully");
	} catch (error) {
		logger.error("Error shutting down OpenTelemetry SDK", error as Error);
		throw error;
	}
}

// Re-export trace API for convenience
export { trace };

// Re-export middleware
export {
	createTracingMiddleware,
	type TracingMiddlewareOptions,
} from "./middleware.js";
