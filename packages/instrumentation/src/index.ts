import { TraceExporter } from "@google-cloud/opentelemetry-cloud-trace-exporter";
import { CloudPropagator } from "@google-cloud/opentelemetry-cloud-trace-propagator";
import { createLogger } from "@llmgateway/logger";
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
} from "@opentelemetry/sdk-trace-base";

const logger = createLogger({ name: "instrumentation" });

function getSamplerConfig() {
	const sampleRate = process.env.OTEL_SAMPLE_RATE;

	if (sampleRate === undefined) {
		return {
			sampler: new AlwaysOnSampler(),
			description: "100% (always on)",
		};
	}

	const rate = parseFloat(sampleRate);
	if (isNaN(rate) || rate < 0 || rate > 1) {
		logger.warn(
			`Invalid OTEL_SAMPLE_RATE value "${sampleRate}", using 100% sampling`,
		);
		return {
			sampler: new AlwaysOnSampler(),
			description: "100% (always on, invalid rate specified)",
		};
	}

	if (rate === 1) {
		return {
			sampler: new AlwaysOnSampler(),
			description: "100% (always on)",
		};
	}

	if (rate === 0) {
		return {
			sampler: new TraceIdRatioBasedSampler(rate),
			description: "0% (never sample)",
		};
	}

	return {
		sampler: new TraceIdRatioBasedSampler(rate),
		description: `${Math.round(rate * 100)}% (ratio-based)`,
	};
}

export interface InstrumentationConfig {
	serviceName: string;
	projectId?: string;
}

export function initializeInstrumentation(
	config: InstrumentationConfig,
): NodeSDK {
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
		sdk.start();
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
	}

	process.on("SIGTERM", () => {
		// Ensure spans are flushed before shutdown
		spanProcessor
			.forceFlush()
			.then(() => sdk.shutdown())
			.then(() => {
				logger.info("Tracing terminated and spans flushed");
			})
			.catch((error) => {
				logger.error("Error terminating tracing", error as Error);
			})
			.finally(() => process.exit(0));
	});

	return sdk;
}

// Re-export trace API for convenience
export { trace };

// Re-export middleware
export {
	createTracingMiddleware,
	type TracingMiddlewareOptions,
} from "./middleware.js";
