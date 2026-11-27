import {
	AlwaysOnSampler,
	TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-base";

import { createLogger } from "@llmgateway/logger";

import { ErrorAwareSampler } from "./error-aware.js";
import { HeaderBasedForceSampler } from "./header-based-force.js";

import type { Sampler } from "@opentelemetry/sdk-trace-base";

const logger = createLogger({ name: "instrumentation" });

export function getSamplerConfig() {
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
	let completionSampler: ErrorAwareSampler | undefined;

	if (errorSampleRate !== undefined && errorSampleRate !== sampleRate) {
		completionSampler = new ErrorAwareSampler(normalSampler, errorSampler);
		baseSampler = completionSampler;
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
		completionSampler,
		description,
	};
}
