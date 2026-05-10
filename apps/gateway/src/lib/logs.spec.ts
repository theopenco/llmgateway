import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UnifiedFinishReason } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import {
	calculateDataStorageCost,
	getUnifiedFinishReason,
	isContentFilterFinishReason,
	isExpectedUnknownFinishReason,
	warnUnknownFinishReasonFallback,
} from "./logs.js";

describe("getUnifiedFinishReason", () => {
	it("maps OpenAI finish reasons correctly", () => {
		expect(getUnifiedFinishReason("stop", "openai")).toBe(
			UnifiedFinishReason.COMPLETED,
		);
		expect(getUnifiedFinishReason("length", "openai")).toBe(
			UnifiedFinishReason.LENGTH_LIMIT,
		);
		expect(getUnifiedFinishReason("content_filter", "openai")).toBe(
			UnifiedFinishReason.CONTENT_FILTER,
		);
	});

	it("maps Anthropic finish reasons correctly", () => {
		expect(getUnifiedFinishReason("stop_sequence", "anthropic")).toBe(
			UnifiedFinishReason.COMPLETED,
		);
		expect(getUnifiedFinishReason("max_tokens", "anthropic")).toBe(
			UnifiedFinishReason.LENGTH_LIMIT,
		);
		expect(getUnifiedFinishReason("end_turn", "anthropic")).toBe(
			UnifiedFinishReason.COMPLETED,
		);
		expect(getUnifiedFinishReason("refusal", "anthropic")).toBe(
			UnifiedFinishReason.CONTENT_FILTER,
		);
	});

	it("maps Google AI Studio finish reasons correctly (original Google format)", () => {
		expect(getUnifiedFinishReason("STOP", "google-ai-studio")).toBe(
			UnifiedFinishReason.COMPLETED,
		);
		expect(getUnifiedFinishReason("MAX_TOKENS", "google-ai-studio")).toBe(
			UnifiedFinishReason.LENGTH_LIMIT,
		);
		expect(getUnifiedFinishReason("SAFETY", "google-ai-studio")).toBe(
			UnifiedFinishReason.CONTENT_FILTER,
		);
		expect(
			getUnifiedFinishReason("PROHIBITED_CONTENT", "google-ai-studio"),
		).toBe(UnifiedFinishReason.CONTENT_FILTER);
		expect(getUnifiedFinishReason("RECITATION", "google-ai-studio")).toBe(
			UnifiedFinishReason.CONTENT_FILTER,
		);
		expect(getUnifiedFinishReason("BLOCKLIST", "google-ai-studio")).toBe(
			UnifiedFinishReason.CONTENT_FILTER,
		);
		expect(getUnifiedFinishReason("SPII", "google-ai-studio")).toBe(
			UnifiedFinishReason.CONTENT_FILTER,
		);
		expect(getUnifiedFinishReason("LANGUAGE", "google-ai-studio")).toBe(
			UnifiedFinishReason.CONTENT_FILTER,
		);
		expect(getUnifiedFinishReason("IMAGE_SAFETY", "google-ai-studio")).toBe(
			UnifiedFinishReason.CONTENT_FILTER,
		);
		expect(
			getUnifiedFinishReason("IMAGE_PROHIBITED_CONTENT", "google-ai-studio"),
		).toBe(UnifiedFinishReason.CONTENT_FILTER);
		expect(getUnifiedFinishReason("IMAGE_RECITATION", "google-ai-studio")).toBe(
			UnifiedFinishReason.CONTENT_FILTER,
		);
		expect(getUnifiedFinishReason("IMAGE_OTHER", "google-ai-studio")).toBe(
			UnifiedFinishReason.CONTENT_FILTER,
		);
		expect(getUnifiedFinishReason("NO_IMAGE", "google-ai-studio")).toBe(
			UnifiedFinishReason.CONTENT_FILTER,
		);
		expect(getUnifiedFinishReason("OTHER", "google-ai-studio")).toBe(
			UnifiedFinishReason.UNKNOWN,
		);
	});

	it("maps OpenAI-format finish reasons returned by Google providers", () => {
		expect(getUnifiedFinishReason("stop", "google-ai-studio")).toBe(
			UnifiedFinishReason.COMPLETED,
		);
		expect(getUnifiedFinishReason("length", "google-ai-studio")).toBe(
			UnifiedFinishReason.LENGTH_LIMIT,
		);
		expect(getUnifiedFinishReason("tool_calls", "google-ai-studio")).toBe(
			UnifiedFinishReason.TOOL_CALLS,
		);
		expect(getUnifiedFinishReason("length", "google-vertex")).toBe(
			UnifiedFinishReason.LENGTH_LIMIT,
		);
		expect(
			getUnifiedFinishReason("MALFORMED_FUNCTION_CALL", "google-ai-studio"),
		).toBe(UnifiedFinishReason.TOOL_CALLS);
	});

	it("maps Glacier finish reasons like Google AI Studio", () => {
		expect(getUnifiedFinishReason("STOP", "glacier")).toBe(
			UnifiedFinishReason.COMPLETED,
		);
		expect(getUnifiedFinishReason("MAX_TOKENS", "glacier")).toBe(
			UnifiedFinishReason.LENGTH_LIMIT,
		);
		expect(getUnifiedFinishReason("SAFETY", "glacier")).toBe(
			UnifiedFinishReason.CONTENT_FILTER,
		);
		expect(getUnifiedFinishReason("OTHER", "glacier")).toBe(
			UnifiedFinishReason.UNKNOWN,
		);
	});

	it("maps Glacier image content filter finish reasons correctly", () => {
		expect(getUnifiedFinishReason("IMAGE_PROHIBITED_CONTENT", "glacier")).toBe(
			UnifiedFinishReason.CONTENT_FILTER,
		);
		expect(getUnifiedFinishReason("IMAGE_SAFETY", "glacier")).toBe(
			UnifiedFinishReason.CONTENT_FILTER,
		);
		expect(getUnifiedFinishReason("NO_IMAGE", "glacier")).toBe(
			UnifiedFinishReason.CONTENT_FILTER,
		);
	});

	it("maps Mistral finish reasons correctly", () => {
		expect(getUnifiedFinishReason("stop", "mistral")).toBe(
			UnifiedFinishReason.COMPLETED,
		);
		expect(getUnifiedFinishReason("length", "mistral")).toBe(
			UnifiedFinishReason.LENGTH_LIMIT,
		);
		expect(getUnifiedFinishReason("model_length", "mistral")).toBe(
			UnifiedFinishReason.LENGTH_LIMIT,
		);
		expect(getUnifiedFinishReason("tool_calls", "mistral")).toBe(
			UnifiedFinishReason.TOOL_CALLS,
		);
		expect(getUnifiedFinishReason("content_filter", "mistral")).toBe(
			UnifiedFinishReason.CONTENT_FILTER,
		);
		expect(getUnifiedFinishReason("error", "mistral")).toBe(
			UnifiedFinishReason.UPSTREAM_ERROR,
		);
	});

	it("handles special cases", () => {
		expect(getUnifiedFinishReason("canceled", "any-provider")).toBe(
			UnifiedFinishReason.CANCELED,
		);
		expect(getUnifiedFinishReason("gateway_error", "any-provider")).toBe(
			UnifiedFinishReason.GATEWAY_ERROR,
		);
		expect(getUnifiedFinishReason("upstream_error", "any-provider")).toBe(
			UnifiedFinishReason.UPSTREAM_ERROR,
		);
		expect(getUnifiedFinishReason(null, "any-provider")).toBe(
			UnifiedFinishReason.UNKNOWN,
		);
		expect(getUnifiedFinishReason(undefined, "any-provider")).toBe(
			UnifiedFinishReason.UNKNOWN,
		);
		expect(getUnifiedFinishReason("unknown_reason", "any-provider")).toBe(
			UnifiedFinishReason.UNKNOWN,
		);
	});

	it("maps llmgateway_content_filter to CONTENT_FILTER", () => {
		expect(
			getUnifiedFinishReason("llmgateway_content_filter", "any-provider"),
		).toBe(UnifiedFinishReason.CONTENT_FILTER);
		expect(getUnifiedFinishReason("llmgateway_content_filter", "openai")).toBe(
			UnifiedFinishReason.CONTENT_FILTER,
		);
	});
});

describe("isExpectedUnknownFinishReason", () => {
	it("returns true for Google OTHER finish reason", () => {
		expect(isExpectedUnknownFinishReason("OTHER", "google-ai-studio")).toBe(
			true,
		);
		expect(isExpectedUnknownFinishReason("OTHER", "glacier")).toBe(true);
		expect(isExpectedUnknownFinishReason("OTHER", "google-vertex")).toBe(true);
	});

	it("returns false for OTHER from other providers", () => {
		expect(isExpectedUnknownFinishReason("OTHER", "openai")).toBe(false);
		expect(isExpectedUnknownFinishReason("OTHER", "anthropic")).toBe(false);
	});

	it("returns false for other finish reasons from Google", () => {
		expect(isExpectedUnknownFinishReason("STOP", "google-ai-studio")).toBe(
			false,
		);
		expect(isExpectedUnknownFinishReason("unknown", "google-ai-studio")).toBe(
			false,
		);
	});

	it("returns false for null or undefined finish reasons", () => {
		expect(isExpectedUnknownFinishReason(null, "google-ai-studio")).toBe(false);
		expect(isExpectedUnknownFinishReason(undefined, "google-ai-studio")).toBe(
			false,
		);
	});
});

describe("isContentFilterFinishReason", () => {
	it("returns true for Google-compatible image filter finish reasons", () => {
		expect(
			isContentFilterFinishReason("IMAGE_PROHIBITED_CONTENT", "glacier"),
		).toBe(true);
		expect(
			isContentFilterFinishReason(
				"IMAGE_PROHIBITED_CONTENT",
				"google-ai-studio",
			),
		).toBe(true);
	});

	it("returns false for Google OTHER finish reason", () => {
		expect(isContentFilterFinishReason("OTHER", "glacier")).toBe(false);
	});

	it("returns true for OpenAI content filters", () => {
		expect(isContentFilterFinishReason("content_filter", "openai")).toBe(true);
	});
});

describe("calculateDataStorageCost", () => {
	it("calculates cost based on total tokens", () => {
		// 1M tokens = $0.01 (formula: totalTokens / 1_000_000 * 0.01)
		const cost = calculateDataStorageCost(500000, 0, 500000, 0);
		expect(cost).toBe("0.01"); // 1M tokens * $0.01 per 1M = $0.01
	});

	it("does not double-count cached tokens when promptTokens already includes them", () => {
		// promptTokens is the canonical input count in gateway logs.
		// cachedTokens is tracked separately for pricing and diagnostics, but should
		// not increase storage accounting a second time.
		const cost = calculateDataStorageCost(500000, 250000, 250000, 250000);
		expect(cost).toBe("0.01"); // 1M tokens * $0.01 per 1M = $0.01
	});

	it("returns zero when retention level is none", () => {
		const cost = calculateDataStorageCost(1000000, 0, 1000000, 0, "none");
		expect(cost).toBe("0");
	});

	it("calculates cost when retention level is retain", () => {
		const cost = calculateDataStorageCost(500000, 0, 500000, 0, "retain");
		expect(cost).toBe("0.01");
	});

	it("calculates cost when retention level is null", () => {
		const cost = calculateDataStorageCost(500000, 0, 500000, 0, null);
		expect(cost).toBe("0.01");
	});

	it("calculates cost when retention level is undefined", () => {
		const cost = calculateDataStorageCost(500000, 0, 500000, 0, undefined);
		expect(cost).toBe("0.01");
	});

	it("handles null and undefined token values", () => {
		const cost = calculateDataStorageCost(null, undefined, null, undefined);
		expect(cost).toBe("0");
	});

	it("handles string token values", () => {
		const cost = calculateDataStorageCost("500000", "0", "500000", "0");
		expect(cost).toBe("0.01");
	});
});

describe("warnUnknownFinishReasonFallback", () => {
	let warnSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		warnSpy.mockRestore();
	});

	it("warns when an unmapped reason falls back to UNKNOWN", () => {
		warnUnknownFinishReasonFallback({
			finishReason: "empty",
			provider: "azure-ai-foundry",
			usedModel: "azure-ai-foundry/grok-4-1-fast-non-reasoning",
			requestId: "req_abc",
			streamed: false,
			rawChunk: '{"choices":[{"finish_reason":"empty"}]}',
		});

		expect(warnSpy).toHaveBeenCalledTimes(1);
		const [msg, ctx] = warnSpy.mock.calls[0] as [string, Record<string, any>];
		expect(msg).toBe("Unknown finish reason fallback to UNKNOWN");
		expect(ctx).toMatchObject({
			finishReason: "empty",
			provider: "azure-ai-foundry",
			usedModel: "azure-ai-foundry/grok-4-1-fast-non-reasoning",
			requestId: "req_abc",
			streamed: false,
		});
		expect(ctx.rawChunk).toContain('"empty"');
	});

	it("does not warn when the reason maps cleanly", () => {
		warnUnknownFinishReasonFallback({
			finishReason: "stop",
			provider: "openai",
			usedModel: "gpt-4o-mini",
			streamed: true,
		});
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it("does not warn for expected UNKNOWN mappings (Google's OTHER)", () => {
		warnUnknownFinishReasonFallback({
			finishReason: "OTHER",
			provider: "google-ai-studio",
			usedModel: "gemini-2.5-pro",
			streamed: false,
		});
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it("truncates raw chunks larger than the cap and notes the truncation", () => {
		const big = "x".repeat(8192);
		warnUnknownFinishReasonFallback({
			finishReason: "weird_reason",
			provider: "openai",
			usedModel: "gpt-4o-mini",
			streamed: true,
			rawChunk: big,
		});
		expect(warnSpy).toHaveBeenCalledTimes(1);
		const ctx = warnSpy.mock.calls[0][1] as Record<string, any>;
		expect(ctx.rawChunk).toMatch(/\[truncated \d+ chars\]$/);
		expect(typeof ctx.rawChunk).toBe("string");
		expect((ctx.rawChunk as string).length).toBeLessThan(big.length);
	});

	it("warns when finishReason is null/empty (also UNKNOWN, not expected)", () => {
		warnUnknownFinishReasonFallback({
			finishReason: null,
			provider: "openai",
			usedModel: "gpt-4o-mini",
			streamed: false,
		});
		expect(warnSpy).toHaveBeenCalledTimes(1);
	});
});
