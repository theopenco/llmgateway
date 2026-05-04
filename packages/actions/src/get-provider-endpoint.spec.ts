import { afterEach, describe, expect, it } from "vitest";

import { getProviderEndpoint } from "./get-provider-endpoint.js";

const originalAiStudioBaseUrl = process.env.LLM_GOOGLE_AI_STUDIO_BASE_URL;
const originalGlacierBaseUrl = process.env.LLM_GLACIER_BASE_URL;
const originalVertexBaseUrl = process.env.LLM_GOOGLE_VERTEX_BASE_URL;
const originalVertexProject = process.env.LLM_GOOGLE_CLOUD_PROJECT;
const originalVertexRegion = process.env.LLM_GOOGLE_VERTEX_REGION;
const originalAzureFoundryResource = process.env.LLM_AZURE_AI_FOUNDRY_RESOURCE;
const originalAzureFoundryApiVersion =
	process.env.LLM_AZURE_AI_FOUNDRY_API_VERSION;

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

	if (originalAzureFoundryResource === undefined) {
		delete process.env.LLM_AZURE_AI_FOUNDRY_RESOURCE;
	} else {
		process.env.LLM_AZURE_AI_FOUNDRY_RESOURCE = originalAzureFoundryResource;
	}

	if (originalAzureFoundryApiVersion === undefined) {
		delete process.env.LLM_AZURE_AI_FOUNDRY_API_VERSION;
	} else {
		process.env.LLM_AZURE_AI_FOUNDRY_API_VERSION =
			originalAzureFoundryApiVersion;
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

	describe("azure-ai-foundry", () => {
		it("builds the Azure AI Foundry endpoint from the resource env var", () => {
			process.env.LLM_AZURE_AI_FOUNDRY_RESOURCE = "gkapitech";

			const endpoint = getProviderEndpoint(
				"azure-ai-foundry",
				undefined,
				"grok-4-1-fast-non-reasoning",
			);

			expect(endpoint).toBe(
				"https://gkapitech.services.ai.azure.com/models/chat/completions?api-version=2024-05-01-preview",
			);
		});

		it("respects an api version override", () => {
			process.env.LLM_AZURE_AI_FOUNDRY_RESOURCE = "gkapitech";
			process.env.LLM_AZURE_AI_FOUNDRY_API_VERSION = "2025-01-01-preview";

			const endpoint = getProviderEndpoint(
				"azure-ai-foundry",
				undefined,
				"grok-4-1-fast-reasoning",
			);

			expect(endpoint).toBe(
				"https://gkapitech.services.ai.azure.com/models/chat/completions?api-version=2025-01-01-preview",
			);
		});

		it("throws when no resource is configured", () => {
			delete process.env.LLM_AZURE_AI_FOUNDRY_RESOURCE;

			expect(() =>
				getProviderEndpoint(
					"azure-ai-foundry",
					undefined,
					"grok-4-1-fast-non-reasoning",
				),
			).toThrow(/Azure AI Foundry resource is required/);
		});

		it.each([
			"evil.com/path",
			"resource.evil.com",
			"resource:8080",
			"https://evil.com",
			"a/b",
			"a b",
			"",
		])("rejects an invalid resource name (%s)", (resource) => {
			process.env.LLM_AZURE_AI_FOUNDRY_RESOURCE = resource;

			expect(() =>
				getProviderEndpoint(
					"azure-ai-foundry",
					undefined,
					"grok-4-1-fast-non-reasoning",
				),
			).toThrow(/Azure AI Foundry resource (is invalid|is required)/);
		});
	});

	describe("skipEnvVars (BYOK mode)", () => {
		it("uses hardcoded default for google-ai-studio instead of env var", () => {
			process.env.LLM_GOOGLE_AI_STUDIO_BASE_URL =
				"https://studio-override.example";

			const endpoint = getProviderEndpoint(
				"google-ai-studio",
				undefined, // no baseUrl
				"gemini-2.5-flash",
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				true, // skipEnvVars
			);

			expect(endpoint).toBe(
				"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
			);
		});

		it("uses hardcoded default for openai regardless of skipEnvVars", () => {
			const endpoint = getProviderEndpoint(
				"openai",
				undefined,
				"gpt-4o",
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				true, // skipEnvVars
			);

			expect(endpoint).toBe("https://api.openai.com/v1/chat/completions");
		});

		it("uses hardcoded default for google-vertex base URL in skipEnvVars mode", () => {
			process.env.LLM_GOOGLE_VERTEX_BASE_URL =
				"https://vertex-override.example";

			const endpoint = getProviderEndpoint(
				"google-vertex",
				undefined,
				"gemini-2.5-flash-lite",
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				true, // skipEnvVars
			);

			expect(endpoint).toBe(
				"https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash-lite:generateContent",
			);
		});

		it("uses hardcoded default for aws-bedrock base URL in skipEnvVars mode", () => {
			const endpoint = getProviderEndpoint(
				"aws-bedrock",
				undefined,
				"anthropic.claude-3-5-sonnet-20241022-v2:0",
				undefined,
				false,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				true, // skipEnvVars
			);

			expect(endpoint).toBe(
				"https://bedrock-runtime.us-east-1.amazonaws.com/model/global.anthropic.claude-3-5-sonnet-20241022-v2:0/converse",
			);
		});

		it("still uses explicit baseUrl even when skipEnvVars is true", () => {
			const endpoint = getProviderEndpoint(
				"google-ai-studio",
				"https://my-custom-base.example",
				"gemini-2.5-flash",
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				true, // skipEnvVars
			);

			expect(endpoint).toBe(
				"https://my-custom-base.example/v1beta/models/gemini-2.5-flash:generateContent",
			);
		});
	});
});
