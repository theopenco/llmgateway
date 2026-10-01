import { describe, expect, test } from "vitest";

import { isCustomModelUnavailableError } from "./custom-model-unavailable.js";

describe("isCustomModelUnavailableError", () => {
	test.each([
		`{"error":{"message":"Model 'gpt-5.4-nano' is temporarily not supported"}}`,
		`{"error":{"message":"The model \`gpt-5.4-nano\` does not exist or you do not have access to it."}}`,
		`{"error":{"message":"model \\"gpt-5.4-nano\\" not found"}}`,
		`{"error":{"message":"Model gpt-5.4-nano is currently unavailable"}}`,
		`{"error":{"code":"model_not_found","message":"nope"}}`,
	])("matches %s", (errorText) => {
		expect(isCustomModelUnavailableError(errorText, "gpt-5.4-nano")).toBe(true);
	});

	test.each([
		`{"error":{"message":"tools are not supported for model 'gpt-5.4-nano'"}}`,
		`{"error":{"message":"Model 'gpt-5.4-nano' does not support images"}}`,
		`{"error":{"message":"temperature is not supported"}}`,
		`{"error":{"message":"Model 'gpt-5.4' is not supported"}}`,
		"",
	])("ignores %s", (errorText) => {
		expect(isCustomModelUnavailableError(errorText, "gpt-5.4-nano")).toBe(
			false,
		);
	});

	test("ignores a missing model name", () => {
		expect(
			isCustomModelUnavailableError("Model 'x' is not supported", undefined),
		).toBe(false);
	});
});
