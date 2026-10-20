import { afterAll, expect, test, vi } from "vitest";

import { serviceTierModels, testModels } from "./chat-helpers.e2e.js";

vi.hoisted(() => {
	vi.stubEnv("TEST_ALL_VARIATIONS", "1");
	vi.stubEnv("TEST_MODELS", "google-ai-studio/gemini-3.1-flash-lite");
	vi.stubEnv("TEST_PROVIDERS", "");
});

afterAll(() => vi.unstubAllEnvs());

test("collects canonical and pinned model cases without an image lookup crash", () => {
	expect(testModels.map(({ model }) => model)).toEqual([
		"gemini-3.1-flash-lite",
		"google-ai-studio/gemini-3.1-flash-lite",
	]);
});

test("keeps service-tier pricing cases pinned to their provider mapping", () => {
	expect(serviceTierModels.length).toBeGreaterThan(0);
	for (const entry of serviceTierModels) {
		expect(entry.model.startsWith(`${entry.mapping.providerId}/`)).toBe(true);
	}
});
