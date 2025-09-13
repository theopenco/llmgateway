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

function getSamplerConfig() {
	const sampleRate = process.env.OTEL_SAMPLE_RATE;

	let baseSampler: Sampler;
	let baseDescription: string;

	if (sampleRate === undefined) {
		baseSampler = new AlwaysOnSampler();
		baseDescription = "100% (always on)";
	} else {
		const rate = parseFloat(sampleRate);
		if (isNaN(rate) || rate < 0 || rate > 1) {
			logger.warn(
				`Invalid OTEL_SAMPLE_RATE value "${sampleRate}", using 100% sampling`,
			);
			baseSampler = new AlwaysOnSampler();
			baseDescription = "100% (always on, invalid rate specified)";
		} else if (rate === 1) {
			baseSampler = new AlwaysOnSampler();
			baseDescription = "100% (always on)";
		} else if (rate === 0) {
			baseSampler = new TraceIdRatioBasedSampler(rate);
			baseDescription = "0% (never sample)";
		} else {
			baseSampler = new TraceIdRatioBasedSampler(rate);
			baseDescription = `${Math.round(rate * 100)}% (ratio-based)`;
		}
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
