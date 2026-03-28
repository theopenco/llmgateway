import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetRoundRobinCounters } from "@/lib/round-robin-env.js";

import { getProviderEnv } from "./get-provider-env.js";

describe("getProviderEnv", () => {
	const originalOpenAIKey = process.env.LLM_OPENAI_API_KEY;

	beforeEach(() => {
		resetRoundRobinCounters();
		process.env.LLM_OPENAI_API_KEY = "sk-openai-a,sk-openai-b,sk-openai-c";
	});

	afterEach(() => {
		if (originalOpenAIKey === undefined) {
			delete process.env.LLM_OPENAI_API_KEY;
			return;
		}

		process.env.LLM_OPENAI_API_KEY = originalOpenAIKey;
	});

	it("supports non-advancing lookups for auxiliary requests", () => {
		const completionSelection = getProviderEnv("openai");
		expect(completionSelection.token).toBe("sk-openai-a");
		expect(completionSelection.configIndex).toBe(0);

		const moderationSelection = getProviderEnv("openai", {
			advanceRoundRobin: false,
		});
		expect(moderationSelection.token).toBe("sk-openai-b");
		expect(moderationSelection.configIndex).toBe(1);

		const nextCompletionSelection = getProviderEnv("openai");
		expect(nextCompletionSelection.token).toBe("sk-openai-b");
		expect(nextCompletionSelection.configIndex).toBe(1);
	});

	it("defaults to advancing round-robin selection", () => {
		expect(getProviderEnv("openai").configIndex).toBe(0);
		expect(getProviderEnv("openai").configIndex).toBe(1);
	});
});
