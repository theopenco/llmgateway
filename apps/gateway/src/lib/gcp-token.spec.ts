import { afterEach, describe, expect, it, vi } from "vitest";

import {
	getVertexAnthropicProjectId,
	usesServiceAccountAccessToken,
} from "./gcp-token.js";

describe("Vertex Anthropic env credential", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("derives the project from the service account", () => {
		vi.stubEnv(
			"LLM_VERTEX_ANTHROPIC_SERVICE_ACCOUNT_JSON",
			JSON.stringify({ project_id: "env-project" }),
		);
		expect(getVertexAnthropicProjectId()).toBe("env-project");
	});

	it("returns null when no credential is configured", () => {
		vi.stubEnv("LLM_VERTEX_ANTHROPIC_SERVICE_ACCOUNT_JSON", "");
		expect(getVertexAnthropicProjectId()).toBeNull();
	});
});

describe("usesServiceAccountAccessToken", () => {
	it.each([
		["vertex-anthropic", true],
		["vertex-openai", true],
		["google-vertex", false],
		["anthropic", false],
	])("%s → %s", (provider, expected) => {
		expect(usesServiceAccountAccessToken(provider)).toBe(expected);
	});
});
