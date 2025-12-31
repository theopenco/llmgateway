import { describe, expect, it } from "vitest";

import { UnifiedFinishReason } from "@llmgateway/db";

import {
	calculateDataStorageCost,
	getUnifiedFinishReason,
	isExpectedUnknownFinishReason,
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
});

describe("isExpectedUnknownFinishReason", () => {
	it("returns true for Google OTHER finish reason", () => {
		expect(isExpectedUnknownFinishReason("OTHER", "google-ai-studio")).toBe(
			true,
		);
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

describe("calculateDataStorageCost", () => {
	it("calculates cost based on total tokens", () => {
		// 1M tokens = $0.01 (formula: totalTokens / 1_000_000 * 0.01)
		const cost = calculateDataStorageCost(500000, 0, 500000, 0);
		expect(cost).toBe("0.01"); // 1M tokens * $0.01 per 1M = $0.01
	});

	it("includes all token types in calculation", () => {
		// 250k prompt + 250k cached + 250k completion + 250k reasoning = 1M tokens
		const cost = calculateDataStorageCost(250000, 250000, 250000, 250000);
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
