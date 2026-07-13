import { describe, it, expect, vi } from "vitest";

import {
	isRetryableErrorType,
	sameKeyRetryDelay,
	SAME_KEY_RETRY_DELAY_MS,
	shouldRetryAlternateKey,
	shouldRetrySameKey,
	shouldRetryRequest,
	selectNextProvider,
	getErrorType,
	MAX_RETRIES,
} from "./retry-with-fallback.js";

describe("isRetryableErrorType", () => {
	it("retries on upstream/provider error types", () => {
		expect(isRetryableErrorType("upstream_error")).toBe(true);
		expect(isRetryableErrorType("provider_error")).toBe(true);
	});

	it("retries on network and timeout error types", () => {
		expect(isRetryableErrorType("network_error")).toBe(true);
		expect(isRetryableErrorType("upstream_timeout")).toBe(true);
	});

	it("retries on gateway errors (e.g. 401/403 from provider)", () => {
		expect(isRetryableErrorType("gateway_error")).toBe(true);
	});

	it("does not retry on non-retryable error types", () => {
		expect(isRetryableErrorType("client_error")).toBe(false);
		expect(isRetryableErrorType("content_filter")).toBe(false);
	});
});

describe("shouldRetryRequest", () => {
	const defaultOpts = {
		requestedProvider: undefined,
		noFallback: false,
		errorType: "upstream_error",
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
		expect(
			shouldRetryRequest({ ...defaultOpts, errorType: "client_error" }),
		).toBe(false);
		expect(
			shouldRetryRequest({ ...defaultOpts, errorType: "content_filter" }),
		).toBe(false);
	});

	it("retries on gateway errors so auto-route can fall back over 401/403", () => {
		expect(
			shouldRetryRequest({ ...defaultOpts, errorType: "gateway_error" }),
		).toBe(true);
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

	it("retries on provider-originated errors", () => {
		expect(
			shouldRetryRequest({ ...defaultOpts, errorType: "provider_error" }),
		).toBe(true);
	});

	it("retries on upstream errors", () => {
		expect(
			shouldRetryRequest({ ...defaultOpts, errorType: "upstream_error" }),
		).toBe(true);
	});

	it("retries on network errors", () => {
		expect(
			shouldRetryRequest({ ...defaultOpts, errorType: "network_error" }),
		).toBe(true);
	});

	it("retries on upstream timeouts", () => {
		expect(
			shouldRetryRequest({ ...defaultOpts, errorType: "upstream_timeout" }),
		).toBe(true);
	});
});

describe("shouldRetryAlternateKey", () => {
	it("retries alternate keys for retryable upstream failures", () => {
		expect(shouldRetryAlternateKey("upstream_error", 500)).toBe(true);
		expect(shouldRetryAlternateKey("network_error", 0)).toBe(true);
	});

	it("retries alternate keys for auth failures on the current provider", () => {
		expect(shouldRetryAlternateKey("gateway_error", 401)).toBe(true);
		expect(shouldRetryAlternateKey("gateway_error", 403)).toBe(true);
	});

	it("retries alternate keys for invalid API key payloads without 401/403", () => {
		expect(
			shouldRetryAlternateKey(
				"gateway_error",
				400,
				"API key not valid. Please pass a valid API key.",
			),
		).toBe(true);
	});

	it("does not retry alternate keys for non-retryable failure types", () => {
		expect(shouldRetryAlternateKey("client_error", 400)).toBe(false);
		expect(shouldRetryAlternateKey("content_filter", 403)).toBe(false);
	});
});

describe("shouldRetrySameKey", () => {
	const defaultOpts = {
		usedProvider: "openai",
		errorType: "upstream_error",
		statusCode: 500,
		envVarName: "OPENAI_API_KEY",
		envKeyCount: 1,
		hasOtherProvider: false,
		retryCount: 0,
		maxRetries: 2,
	};

	it("retries with single env key on upstream error", () => {
		expect(shouldRetrySameKey(defaultOpts)).toBe(true);
	});

	it("does not retry when another provider is available to fall back to", () => {
		expect(shouldRetrySameKey({ ...defaultOpts, hasOtherProvider: true })).toBe(
			false,
		);
	});

	it("retries on upstream timeouts", () => {
		expect(
			shouldRetrySameKey({ ...defaultOpts, errorType: "upstream_timeout" }),
		).toBe(true);
	});

	it("retries on network errors", () => {
		expect(
			shouldRetrySameKey({
				...defaultOpts,
				errorType: "network_error",
				statusCode: 0,
			}),
		).toBe(true);
	});

	it("retries regardless of whether a specific provider was requested", () => {
		// The "no other provider" gate lives at the call site (the
		// provider-fallback check), so this helper no longer keys off
		// requestedProvider — it fires for both direct and auto-routed requests.
		expect(shouldRetrySameKey(defaultOpts)).toBe(true);
	});

	it("does not retry when env var has multiple keys (alternate-key path covers it)", () => {
		expect(shouldRetrySameKey({ ...defaultOpts, envKeyCount: 2 })).toBe(false);
	});

	it("does not retry when no env var was used (BYOK)", () => {
		expect(shouldRetrySameKey({ ...defaultOpts, envVarName: undefined })).toBe(
			false,
		);
	});

	it("does not retry on auth failures (same key will fail again)", () => {
		expect(
			shouldRetrySameKey({
				...defaultOpts,
				errorType: "gateway_error",
				statusCode: 401,
			}),
		).toBe(false);
		expect(
			shouldRetrySameKey({
				...defaultOpts,
				errorType: "gateway_error",
				statusCode: 403,
			}),
		).toBe(false);
	});

	it("does not retry on rate limits (would hammer the rate-limited key)", () => {
		expect(
			shouldRetrySameKey({
				...defaultOpts,
				errorType: "upstream_error",
				statusCode: 429,
			}),
		).toBe(false);
	});

	it("does not retry any 4xx (deterministic for the identical request/key)", () => {
		for (const statusCode of [400, 402, 404, 408, 422, 499]) {
			expect(
				shouldRetrySameKey({
					...defaultOpts,
					errorType: "upstream_error",
					statusCode,
				}),
			).toBe(false);
		}
	});

	it("retries 5xx and network failures (statusCode 0)", () => {
		for (const statusCode of [500, 502, 503, 529]) {
			expect(
				shouldRetrySameKey({
					...defaultOpts,
					errorType: "upstream_error",
					statusCode,
				}),
			).toBe(true);
		}
		expect(
			shouldRetrySameKey({
				...defaultOpts,
				errorType: "network_error",
				statusCode: 0,
			}),
		).toBe(true);
	});

	it("does not retry gateway_error even without an auth status code (invalid key payloads)", () => {
		// e.g. providers returning 400 with "API key not valid" — the
		// alternate-key path rotates keys for these, but the same key would
		// fail identically.
		expect(
			shouldRetrySameKey({
				...defaultOpts,
				errorType: "gateway_error",
				statusCode: 400,
			}),
		).toBe(false);
	});

	it("does not retry on non-retryable error types", () => {
		expect(
			shouldRetrySameKey({ ...defaultOpts, errorType: "client_error" }),
		).toBe(false);
		expect(
			shouldRetrySameKey({ ...defaultOpts, errorType: "content_filter" }),
		).toBe(false);
	});

	it("retries up to maxRetries times then stops", () => {
		expect(shouldRetrySameKey({ ...defaultOpts, retryCount: 1 })).toBe(true);
		expect(shouldRetrySameKey({ ...defaultOpts, retryCount: 2 })).toBe(false);
		expect(shouldRetrySameKey({ ...defaultOpts, retryCount: 3 })).toBe(false);
	});

	it("does not retry at all when maxRetries is 0", () => {
		expect(
			shouldRetrySameKey({ ...defaultOpts, retryCount: 0, maxRetries: 0 }),
		).toBe(false);
	});

	it("does not retry for custom or llmgateway providers", () => {
		expect(shouldRetrySameKey({ ...defaultOpts, usedProvider: "custom" })).toBe(
			false,
		);
		expect(
			shouldRetrySameKey({ ...defaultOpts, usedProvider: "llmgateway" }),
		).toBe(false);
	});

	it("does not retry when env var is unset (envKeyCount=0)", () => {
		expect(shouldRetrySameKey({ ...defaultOpts, envKeyCount: 0 })).toBe(false);
	});
});

describe("sameKeyRetryDelay", () => {
	it("resolves after the fixed delay", async () => {
		vi.useFakeTimers();
		try {
			let resolved = false;
			const pending = sameKeyRetryDelay().then(() => {
				resolved = true;
			});

			await vi.advanceTimersByTimeAsync(SAME_KEY_RETRY_DELAY_MS - 1);
			expect(resolved).toBe(false);

			await vi.advanceTimersByTimeAsync(1);
			await pending;
			expect(resolved).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("selectNextProvider", () => {
	const modelProviders = [
		{ providerId: "openai", externalId: "gpt-4o" },
		{ providerId: "anthropic", externalId: "claude-3-5-sonnet" },
		{ providerId: "google", externalId: "gemini-pro" },
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
		expect(result).toEqual({ providerId: "openai", externalId: "gpt-4o" });
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
			externalId: "claude-3-5-sonnet",
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
			externalId: "claude-3-5-sonnet",
		});
	});

	it("does not retry back to providers excluded by content filter routing", () => {
		const providerScores = [
			{ providerId: "glacier", score: -1, excludedByContentFilter: true },
			{ providerId: "google", score: 0.1 },
			{ providerId: "openai", score: 0.2 },
		];
		const reroutedModelProviders = [
			{ providerId: "glacier", externalId: "gemini-3-pro-image-preview" },
			{ providerId: "google", externalId: "gemini-3-pro-image-preview" },
			{ providerId: "openai", externalId: "gemini-3-pro-image-preview" },
		];

		const result = selectNextProvider(
			providerScores,
			new Set<string>(),
			reroutedModelProviders,
		);

		expect(result).toEqual({
			providerId: "google",
			externalId: "gemini-3-pro-image-preview",
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

	it("returns gateway_error for 401/403 auth status codes", () => {
		expect(getErrorType(401)).toBe("gateway_error");
		expect(getErrorType(403)).toBe("gateway_error");
	});

	it("returns upstream_error for other status codes", () => {
		expect(getErrorType(400)).toBe("upstream_error");
		expect(getErrorType(404)).toBe("upstream_error");
	});
});
