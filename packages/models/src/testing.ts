import { models } from "./models.js";

import type { ProviderModelMapping } from "./models.js";
import type { TestOptions } from "vitest";

/**
 * Helper function to get test options with retry for CI environment
 */
export function getTestOptions(
	opts: { completions?: boolean } = {
		completions: true,
	},
): TestOptions {
	const hasTestOnly = models.some((model) =>
		model.providers.some(
			(provider: ProviderModelMapping) => provider.test === "only",
		),
	);
	return process.env.CI || opts?.completions
		? { retry: process.env.CI ? 3 : 0 }
		: { skip: hasTestOnly || !!process.env.TEST_MODELS };
}

/**
 * Helper function to get concurrent test options with retry for CI environment
 * @returns TestOptions with concurrent: true and CI retry configuration
 */
export function getConcurrentTestOptions(opts?: {
	completions?: boolean;
}): TestOptions {
	return {
		concurrent: process.env.CONCURRENT_TESTS !== "false",
		...getTestOptions(opts),
	};
}
