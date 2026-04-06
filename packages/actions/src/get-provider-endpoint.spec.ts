import { afterEach, describe, expect, it } from "vitest";

import { getProviderEndpoint } from "./get-provider-endpoint.js";

const originalAiStudioBaseUrl = process.env.LLM_GOOGLE_AI_STUDIO_BASE_URL;
const originalGlacierBaseUrl = process.env.LLM_GLACIER_BASE_URL;
const originalVertexBaseUrl = process.env.LLM_GOOGLE_VERTEX_BASE_URL;
const originalVertexProject = process.env.LLM_GOOGLE_CLOUD_PROJECT;
const originalVertexRegion = process.env.LLM_GOOGLE_VERTEX_REGION;

afterEach(() => {
	if (originalAiStudioBaseUrl === undefined) {
		delete process.env.LLM_GOOGLE_AI_STUDIO_BASE_URL;
	} else {
		process.env.LLM_GOOGLE_AI_STUDIO_BASE_URL = originalAiStudioBaseUrl;
	}

	if (originalGlacierBaseUrl === undefined) {
		delete process.env.LLM_GLACIER_BASE_URL;
	} else {
		process.env.LLM_GLACIER_BASE_URL = originalGlacierBaseUrl;
	}

	if (originalVertexBaseUrl === undefined) {
		delete process.env.LLM_GOOGLE_VERTEX_BASE_URL;
	} else {
		process.env.LLM_GOOGLE_VERTEX_BASE_URL = originalVertexBaseUrl;
	}

	if (originalVertexProject === undefined) {
		delete process.env.LLM_GOOGLE_CLOUD_PROJECT;
	} else {
		process.env.LLM_GOOGLE_CLOUD_PROJECT = originalVertexProject;
	}

	if (originalVertexRegion === undefined) {
		delete process.env.LLM_GOOGLE_VERTEX_REGION;
	} else {
		process.env.LLM_GOOGLE_VERTEX_REGION = originalVertexRegion;
	}
});

describe("getProviderEndpoint", () => {
	it("builds Glacier endpoints from env base URL", () => {
		process.env.LLM_GLACIER_BASE_URL = "https://glacier.example.com";

		const endpoint = getProviderEndpoint(
			"glacier",
			undefined,
			"gemini-2.5-pro",
			"glacier-key",
			true,
		);

		expect(endpoint).toBe(
			"https://glacier.example.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?key=glacier-key&alt=sse",
		);
	});

	it("requires Glacier base URL when no override is provided", () => {
		delete process.env.LLM_GLACIER_BASE_URL;

		expect(() => getProviderEndpoint("glacier")).toThrow(
			"Glacier provider requires LLM_GLACIER_BASE_URL environment variable",
		);
	});

	it("uses the AI Studio base URL override when configured", () => {
		process.env.LLM_GOOGLE_AI_STUDIO_BASE_URL =
			"https://studio-override.example";

		const endpoint = getProviderEndpoint(
			"google-ai-studio",
			undefined,
			"gemini-2.5-flash",
		);

		expect(endpoint).toBe(
			"https://studio-override.example/v1beta/models/gemini-2.5-flash:generateContent",
		);
	});

	it("uses the first AI Studio base URL when multiple values are configured without a config slot", () => {
		process.env.LLM_GOOGLE_AI_STUDIO_BASE_URL =
			"https://studio-1.example, https://studio-2.example";

		const endpoint = getProviderEndpoint(
			"google-ai-studio",
			undefined,
			"gemini-2.5-flash",
		);

		expect(endpoint).toBe(
			"https://studio-1.example/v1beta/models/gemini-2.5-flash:generateContent",
		);
	});

	it("uses the indexed AI Studio base URL for the selected config slot", () => {
		process.env.LLM_GOOGLE_AI_STUDIO_BASE_URL =
			"https://studio-1.example, https://studio-2.example, https://studio-3.example";

		const endpoint = getProviderEndpoint(
			"google-ai-studio",
			undefined,
			"gemini-2.5-flash",
			undefined,
			true,
			undefined,
			undefined,
			undefined,
			2,
		);

		expect(endpoint).toBe(
			"https://studio-3.example/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse",
		);
	});

	it("uses the Vertex base URL override for lite models", () => {
		process.env.LLM_GOOGLE_VERTEX_BASE_URL = "https://vertex-override.example";

		const endpoint = getProviderEndpoint(
			"google-vertex",
			undefined,
			"gemini-2.5-flash-lite",
		);

		expect(endpoint).toBe(
			"https://vertex-override.example/v1/publishers/google/models/gemini-2.5-flash-lite:generateContent",
		);
	});

	it("uses the first Vertex base URL when multiple values are configured without a config slot", () => {
		process.env.LLM_GOOGLE_VERTEX_BASE_URL =
			"https://vertex-1.example, https://vertex-2.example";
		process.env.LLM_GOOGLE_CLOUD_PROJECT = "project-a, project-b";
		process.env.LLM_GOOGLE_VERTEX_REGION = "global, us-central1";

		const endpoint = getProviderEndpoint(
			"google-vertex",
			undefined,
			"gemini-2.5-pro",
		);

		expect(endpoint).toBe(
			"https://vertex-1.example/v1/projects/project-a/locations/global/publishers/google/models/gemini-2.5-pro:generateContent",
		);
	});

	it("uses the indexed Vertex base URL for the selected config slot", () => {
		process.env.LLM_GOOGLE_VERTEX_BASE_URL =
			"https://vertex-1.example, https://vertex-2.example";
		process.env.LLM_GOOGLE_CLOUD_PROJECT = "project-a, project-b";
		process.env.LLM_GOOGLE_VERTEX_REGION = "global, us-central1";

		const endpoint = getProviderEndpoint(
			"google-vertex",
			undefined,
			"gemini-2.5-pro",
			undefined,
			true,
			undefined,
			undefined,
			undefined,
			1,
		);

		expect(endpoint).toBe(
			"https://vertex-2.example/v1/projects/project-b/locations/us-central1/publishers/google/models/gemini-2.5-pro:streamGenerateContent?alt=sse",
		);
	});
});
