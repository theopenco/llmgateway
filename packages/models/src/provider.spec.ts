import { afterEach, describe, expect, test } from "vitest";

import {
	getProviderEnvValue,
	hasProviderEnvironmentToken,
} from "./provider.js";

const OPENAI_API_KEY_ENV = "OPENAI_API_KEY";

const originalOpenAiApiKey = process.env[OPENAI_API_KEY_ENV];

afterEach(() => {
	if (originalOpenAiApiKey === undefined) {
		Reflect.deleteProperty(process.env, OPENAI_API_KEY_ENV);
		return;
	}

	process.env[OPENAI_API_KEY_ENV] = originalOpenAiApiKey;
});

describe("provider environment helpers", () => {
	test("treats whitespace-only provider tokens as missing", () => {
		process.env[OPENAI_API_KEY_ENV] = "   ";

		expect(hasProviderEnvironmentToken("openai")).toBe(false);
	});

	test("returns the default value when the configured env var is whitespace-only", () => {
		process.env[OPENAI_API_KEY_ENV] = "   ";

		expect(getProviderEnvValue("openai", "apiKey", undefined, "fallback")).toBe(
			"fallback",
		);
	});
});
