import { describe, expect, it } from "vitest";

import {
	getChatPlanMinimumTier,
	isChatPlanModelAllowed,
} from "./chat-plans.js";

describe("getChatPlanMinimumTier", () => {
	it.each([
		"gpt-5.6-sol",
		"gpt-6-astra",
		"claude-fable-5-1",
		"claude-opus-4-7",
		"gemini-4-argon",
		"gemini-3-pro-preview",
		"grok-4",
	])("requires Plus for frontier model %s", (modelId) => {
		expect(getChatPlanMinimumTier(modelId)).toBe("plus");
	});

	it.each([
		"claude-sonnet-4-6",
		"claude-sonnet-5-5",
		"claude-haiku-4-5",
		"gpt-6.1-sol",
		"gpt-6-sol",
		"gpt-6-luna",
		"gemini-2.5-flash-image",
		"gemini-3.1-flash-lite-image",
		"gpt-image-2",
	])("includes %s on Starter", (modelId) => {
		expect(getChatPlanMinimumTier(modelId)).toBe("starter");
	});

	it("gates text models priced above Claude Sonnet", () => {
		expect(getChatPlanMinimumTier("kimi-k3.1-pro-highspeed")).toBe("plus");
	});

	it("treats unknown ids by pattern only", () => {
		expect(getChatPlanMinimumTier("custom/opus-finetune")).toBe("plus");
		expect(getChatPlanMinimumTier("custom/my-model")).toBe("starter");
	});
});

describe("isChatPlanModelAllowed", () => {
	it("blocks GPT-6 Astra on Starter only", () => {
		expect(isChatPlanModelAllowed("starter", "gpt-6-astra")).toBe(false);
		expect(isChatPlanModelAllowed("plus", "gpt-6-astra")).toBe(true);
		expect(isChatPlanModelAllowed("pro", "gpt-6-astra")).toBe(true);
	});

	it("allows GPT-6.1 Sol on every tier", () => {
		expect(isChatPlanModelAllowed("starter", "gpt-6.1-sol")).toBe(true);
		expect(isChatPlanModelAllowed("plus", "gpt-6.1-sol")).toBe(true);
	});
});
