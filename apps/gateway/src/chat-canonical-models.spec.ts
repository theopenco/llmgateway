import { afterAll, expect, test, vi } from "vitest";

vi.stubEnv("TEST_ALL_VARIATIONS", "1");
vi.stubEnv("TEST_MODELS", "google-ai-studio/gemini-2.5-flash");
vi.stubEnv("TEST_PROVIDERS", "");

const { serviceTierModels, testModels } = await import("./chat-helpers.e2e.js");

afterAll(() => vi.unstubAllEnvs());

test("collects canonical and pinned model cases without an image lookup crash", () => {
	expect(testModels.map(({ model }) => model)).toEqual([
		"gemini-2.5-flash",
		"google-ai-studio/gemini-2.5-flash",
	]);
});

test("keeps service-tier pricing cases pinned to their provider mapping", () => {
	expect(serviceTierModels.length).toBeGreaterThan(0);
	for (const entry of serviceTierModels) {
		expect(entry.model.startsWith(`${entry.mapping.providerId}/`)).toBe(true);
	}
});
