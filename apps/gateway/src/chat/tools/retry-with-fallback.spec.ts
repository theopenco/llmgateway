import { describe, it, expect } from "vitest";

import {
	isRetryableError,
	shouldRetryRequest,
	selectNextProvider,
	getErrorType,
	MAX_RETRIES,
} from "./retry-with-fallback.js";

describe("isRetryableError", () => {
	it("retries on 5xx server errors", () => {
		expect(isRetryableError(500)).toBe(true);
		expect(isRetryableError(502)).toBe(true);
		expect(isRetryableError(503)).toBe(true);
		expect(isRetryableError(504)).toBe(true);
	});

	it("retries on 429 rate limit", () => {
		expect(isRetryableError(429)).toBe(true);
	});

	it("retries on network errors (status 0)", () => {
		expect(isRetryableError(0)).toBe(true);
	});

	it("does not retry on client errors", () => {
		expect(isRetryableError(400)).toBe(false);
		expect(isRetryableError(401)).toBe(false);
		expect(isRetryableError(403)).toBe(false);
		expect(isRetryableError(404)).toBe(false);
		expect(isRetryableError(422)).toBe(false);
	});

	it("does not retry on success codes", () => {
		expect(isRetryableError(200)).toBe(false);
		expect(isRetryableError(201)).toBe(false);
	});
});

describe("shouldRetryRequest", () => {
	const defaultOpts = {
		requestedProvider: undefined,
		noFallback: false,
		statusCode: 500,
		retryCount: 0,
		remainingProviders: 2,
		usedProvider: "openai",
	};

	it("allows retry when all conditions are met", () => {
		expect(shouldRetryRequest(defaultOpts)).toBe(true);
	});

	it("does not retry when a specific provider was requested", () => {
		expect(
			shouldRetryRequest({ ...defaultOpts, requestedProvider: "openai" }),
		).toBe(false);
	});

	it("does not retry when noFallback is true", () => {
		expect(shouldRetryRequest({ ...defaultOpts, noFallback: true })).toBe(
			false,
		);
	});

	it("does not retry on non-retryable status codes", () => {
		expect(shouldRetryRequest({ ...defaultOpts, statusCode: 400 })).toBe(false);
		expect(shouldRetryRequest({ ...defaultOpts, statusCode: 404 })).toBe(false);
	});

	it("does not retry when max retries exceeded", () => {
		expect(
			shouldRetryRequest({ ...defaultOpts, retryCount: MAX_RETRIES }),
		).toBe(false);
		expect(
			shouldRetryRequest({ ...defaultOpts, retryCount: MAX_RETRIES + 1 }),
		).toBe(false);
	});

	it("does not retry when no remaining providers", () => {
		expect(shouldRetryRequest({ ...defaultOpts, remainingProviders: 0 })).toBe(
			false,
		);
		expect(shouldRetryRequest({ ...defaultOpts, remainingProviders: -1 })).toBe(
			false,
		);
	});

	it("does not retry for custom provider", () => {
		expect(shouldRetryRequest({ ...defaultOpts, usedProvider: "custom" })).toBe(
			false,
		);
	});

	it("does not retry for llmgateway provider", () => {
		expect(
			shouldRetryRequest({ ...defaultOpts, usedProvider: "llmgateway" }),
		).toBe(false);
	});

	it("retries on 429 rate limit", () => {
		expect(shouldRetryRequest({ ...defaultOpts, statusCode: 429 })).toBe(true);
	});

	it("retries on network errors (status 0)", () => {
		expect(shouldRetryRequest({ ...defaultOpts, statusCode: 0 })).toBe(true);
	});
});

describe("selectNextProvider", () => {
	const modelProviders = [
		{ providerId: "openai", modelName: "gpt-4o" },
		{ providerId: "anthropic", modelName: "claude-3-5-sonnet" },
		{ providerId: "google", modelName: "gemini-pro" },
	];

	it("selects the lowest-scored non-failed provider", () => {
		const providerScores = [
			{ providerId: "openai", score: 0.5 },
			{ providerId: "anthropic", score: 0.3 },
			{ providerId: "google", score: 0.8 },
		];
		const failedProviders = new Set(["anthropic"]);

		const result = selectNextProvider(
			providerScores,
			failedProviders,
			modelProviders,
		);
		expect(result).toEqual({ providerId: "openai", modelName: "gpt-4o" });
	});

	it("returns null when all providers have failed", () => {
		const providerScores = [
			{ providerId: "openai", score: 0.5 },
			{ providerId: "anthropic", score: 0.3 },
		];
		const failedProviders = new Set(["openai", "anthropic"]);

		const result = selectNextProvider(
			providerScores,
			failedProviders,
			modelProviders,
		);
		expect(result).toBeNull();
	});

	it("returns null when providerScores is empty", () => {
		const result = selectNextProvider([], new Set<string>(), modelProviders);
		expect(result).toBeNull();
	});

	it("returns null when no model mapping exists for scored provider", () => {
		const providerScores = [{ providerId: "unknown-provider", score: 0.1 }];

		const result = selectNextProvider(
			providerScores,
			new Set<string>(),
			modelProviders,
		);
		expect(result).toBeNull();
	});

	it("sorts by score and picks the best available", () => {
		const providerScores = [
			{ providerId: "google", score: 0.8 },
			{ providerId: "openai", score: 0.5 },
			{ providerId: "anthropic", score: 0.1 },
		];
		const failedProviders = new Set<string>();

		const result = selectNextProvider(
			providerScores,
			failedProviders,
			modelProviders,
		);
		expect(result).toEqual({
			providerId: "anthropic",
			modelName: "claude-3-5-sonnet",
		});
	});

	it("skips failed providers and picks the next best", () => {
		const providerScores = [
			{ providerId: "openai", score: 0.2 },
			{ providerId: "anthropic", score: 0.3 },
			{ providerId: "google", score: 0.8 },
		];
		const failedProviders = new Set(["openai"]);

		const result = selectNextProvider(
			providerScores,
			failedProviders,
			modelProviders,
		);
		expect(result).toEqual({
			providerId: "anthropic",
			modelName: "claude-3-5-sonnet",
		});
	});
});

describe("getErrorType", () => {
	it("returns network_error for status 0", () => {
		expect(getErrorType(0)).toBe("network_error");
	});

	it("returns rate_limited for status 429", () => {
		expect(getErrorType(429)).toBe("rate_limited");
	});

	it("returns upstream_error for 5xx status codes", () => {
		expect(getErrorType(500)).toBe("upstream_error");
		expect(getErrorType(502)).toBe("upstream_error");
		expect(getErrorType(503)).toBe("upstream_error");
	});

	it("returns upstream_error for other status codes", () => {
		expect(getErrorType(400)).toBe("upstream_error");
		expect(getErrorType(404)).toBe("upstream_error");
	});
});
