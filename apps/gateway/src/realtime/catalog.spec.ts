import { describe, expect, it } from "vitest";

import { findRealtimeMapping } from "./catalog.js";

describe("findRealtimeMapping", () => {
	it("resolves gpt-realtime to the OpenAI realtime mapping", () => {
		const match = findRealtimeMapping("gpt-realtime");
		expect(match).not.toBeNull();
		expect(match?.modelId).toBe("gpt-realtime");
		expect(match?.mapping.providerId).toBe("openai");
		expect(match?.mapping.realtime).toBe(true);
	});

	it("resolves the dated snapshot alias", () => {
		const match = findRealtimeMapping("gpt-realtime-2025-08-28");
		expect(match?.modelId).toBe("gpt-realtime");
	});

	it("resolves provider-pinned model strings", () => {
		const match = findRealtimeMapping("openai/gpt-realtime-mini");
		expect(match?.modelId).toBe("gpt-realtime-mini");
		expect(match?.mapping.providerId).toBe("openai");
	});

	it("returns null for unknown providers", () => {
		expect(findRealtimeMapping("anthropic/gpt-realtime")).toBeNull();
	});

	it("returns null for chat models without realtime support", () => {
		expect(findRealtimeMapping("gpt-4o-mini")).toBeNull();
	});

	it("returns null for unknown models", () => {
		expect(findRealtimeMapping("not-a-model")).toBeNull();
	});
});
