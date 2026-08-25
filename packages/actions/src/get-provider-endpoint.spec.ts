import { afterEach, describe, expect, it } from "vitest";

import { getProviderEndpoint } from "./get-provider-endpoint.js";

const originalAiStudioBaseUrl = process.env.LLM_GOOGLE_AI_STUDIO_BASE_URL;
const originalGlacierBaseUrl = process.env.LLM_GLACIER_BASE_URL;
const originalPermafrostBaseUrl = process.env.LLM_PERMAFROST_BASE_URL;
const originalVertexBaseUrl = process.env.LLM_GOOGLE_VERTEX_BASE_URL;
const originalVertexProject = process.env.LLM_GOOGLE_CLOUD_PROJECT;
const originalVertexRegion = process.env.LLM_GOOGLE_VERTEX_REGION;
const originalVertexTokenType = process.env.LLM_GOOGLE_VERTEX_TOKEN_TYPE;
const originalAzureFoundryResource = process.env.LLM_AZURE_AI_FOUNDRY_RESOURCE;
const originalAzureFoundryApiVersion =
	process.env.LLM_AZURE_AI_FOUNDRY_API_VERSION;
const originalXiaomiBaseUrl = process.env.LLM_XIAOMI_BASE_URL;
const originalOpenaiBaseUrl = process.env.LLM_OPENAI_BASE_URL;
const originalBedrockBaseUrl = process.env.LLM_AWS_BEDROCK_BASE_URL;
const originalBedrockRegion = process.env.LLM_AWS_BEDROCK_REGION;
const originalMantleRegion = process.env.LLM_AWS_MANTLE_REGION;

afterEach(() => {
	delete process.env.LLM_ALIBABA_WORKSPACE_ID__EU_FRANKFURT;
	delete process.env.LLM_ALIBABA_WORKSPACE_ID__ENTERPRISE__EU_FRANKFURT;

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

	if (originalPermafrostBaseUrl === undefined) {
		delete process.env.LLM_PERMAFROST_BASE_URL;
	} else {
		process.env.LLM_PERMAFROST_BASE_URL = originalPermafrostBaseUrl;
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

	if (originalVertexTokenType === undefined) {
		delete process.env.LLM_GOOGLE_VERTEX_TOKEN_TYPE;
	} else {
		process.env.LLM_GOOGLE_VERTEX_TOKEN_TYPE = originalVertexTokenType;
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

	if (originalXiaomiBaseUrl === undefined) {
		delete process.env.LLM_XIAOMI_BASE_URL;
	} else {
		process.env.LLM_XIAOMI_BASE_URL = originalXiaomiBaseUrl;
	}

	if (originalOpenaiBaseUrl === undefined) {
		delete process.env.LLM_OPENAI_BASE_URL;
	} else {
		process.env.LLM_OPENAI_BASE_URL = originalOpenaiBaseUrl;
	}

	if (originalBedrockBaseUrl === undefined) {
		delete process.env.LLM_AWS_BEDROCK_BASE_URL;
	} else {
		process.env.LLM_AWS_BEDROCK_BASE_URL = originalBedrockBaseUrl;
	}

	if (originalBedrockRegion === undefined) {
		delete process.env.LLM_AWS_BEDROCK_REGION;
	} else {
		process.env.LLM_AWS_BEDROCK_REGION = originalBedrockRegion;
	}

	if (originalMantleRegion === undefined) {
		delete process.env.LLM_AWS_MANTLE_REGION;
	} else {
		process.env.LLM_AWS_MANTLE_REGION = originalMantleRegion;
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

	it("builds Permafrost endpoints from env base URL", () => {
		process.env.LLM_PERMAFROST_BASE_URL = "https://permafrost.example.com";

		expect(getProviderEndpoint("permafrost", undefined, "kimi-k3")).toBe(
			"https://permafrost.example.com/v1/chat/completions",
		);
	});

	it("requires Permafrost base URL when no override is provided", () => {
		delete process.env.LLM_PERMAFROST_BASE_URL;

		expect(() => getProviderEndpoint("permafrost")).toThrow(
			"Permafrost provider requires LLM_PERMAFROST_BASE_URL environment variable",
		);
	});

	it("uses the OpenAI base URL override when configured", () => {
		process.env.LLM_OPENAI_BASE_URL = "http://localhost:8787/openai";

		const endpoint = getProviderEndpoint("openai", undefined, "gpt-4o");

		expect(endpoint).toBe("http://localhost:8787/openai/v1/chat/completions");
	});

	it("defaults to api.openai.com when no OpenAI base URL is configured", () => {
		delete process.env.LLM_OPENAI_BASE_URL;

		const endpoint = getProviderEndpoint("openai", undefined, "gpt-4o");

		expect(endpoint).toBe("https://api.openai.com/v1/chat/completions");
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

	it("uses the Vertex base URL override", () => {
		process.env.LLM_GOOGLE_VERTEX_BASE_URL = "https://vertex-override.example";
		process.env.LLM_GOOGLE_CLOUD_PROJECT = "project-a";

		const endpoint = getProviderEndpoint(
			"google-vertex",
			undefined,
			"gemini-2.5-flash-lite",
		);

		expect(endpoint).toBe(
			"https://vertex-override.example/v1/projects/project-a/locations/global/publishers/google/models/gemini-2.5-flash-lite:generateContent",
		);
	});

	it("uses the projectless Vertex endpoint for API-key auth", () => {
		process.env.LLM_GOOGLE_VERTEX_BASE_URL = "https://vertex-override.example";
		delete process.env.LLM_GOOGLE_CLOUD_PROJECT;

		const endpoint = getProviderEndpoint(
			"google-vertex",
			undefined,
			"gemini-2.5-flash",
			"vertex-api-key",
			true,
		);

		expect(endpoint).toBe(
			"https://vertex-override.example/v1/publishers/google/models/gemini-2.5-flash:streamGenerateContent?key=vertex-api-key&alt=sse",
		);
	});

	it("requires a Vertex project for OAuth auth", () => {
		delete process.env.LLM_GOOGLE_CLOUD_PROJECT;
		process.env.LLM_GOOGLE_VERTEX_TOKEN_TYPE = "oauth";

		expect(() =>
			getProviderEndpoint(
				"google-vertex",
				undefined,
				"gemini-2.5-flash",
				"oauth-token",
			),
		).toThrow(/LLM_GOOGLE_CLOUD_PROJECT/);
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

	describe("vertex oauth token type", () => {
		it("omits ?key= when token type is oauth via env var", () => {
			process.env.LLM_GOOGLE_CLOUD_PROJECT = "project-a";
			process.env.LLM_GOOGLE_VERTEX_REGION = "us-central1";
			process.env.LLM_GOOGLE_VERTEX_TOKEN_TYPE = "oauth";

			const endpoint = getProviderEndpoint(
				"google-vertex",
				undefined,
				"gemini-2.5-pro",
				"ya29.oauth-token",
			);

			expect(endpoint).toBe(
				"https://aiplatform.googleapis.com/v1/projects/project-a/locations/us-central1/publishers/google/models/gemini-2.5-pro:generateContent",
			);
		});

		it("includes ?key= when token type is api-key (default)", () => {
			process.env.LLM_GOOGLE_CLOUD_PROJECT = "project-a";
			process.env.LLM_GOOGLE_VERTEX_REGION = "us-central1";

			const endpoint = getProviderEndpoint(
				"google-vertex",
				undefined,
				"gemini-2.5-pro",
				"AIzaSyExample",
			);

			expect(endpoint).toBe(
				"https://aiplatform.googleapis.com/v1/projects/project-a/locations/us-central1/publishers/google/models/gemini-2.5-pro:generateContent?key=AIzaSyExample",
			);
		});

		it("honors per-key providerKeyOptions over env var", () => {
			process.env.LLM_GOOGLE_CLOUD_PROJECT = "project-a";
			process.env.LLM_GOOGLE_VERTEX_TOKEN_TYPE = "api-key";

			const endpoint = getProviderEndpoint(
				"google-vertex",
				undefined,
				"gemini-2.5-pro",
				"ya29.oauth-token",
				false,
				undefined,
				undefined,
				{ google_vertex_token_type: "oauth" },
			);

			expect(endpoint).toBe(
				"https://aiplatform.googleapis.com/v1/projects/project-a/locations/global/publishers/google/models/gemini-2.5-pro:generateContent",
			);
		});

		it("uses a pre-resolved vertexTokenType over options and env var", () => {
			process.env.LLM_GOOGLE_CLOUD_PROJECT = "project-a";
			process.env.LLM_GOOGLE_VERTEX_TOKEN_TYPE = "api-key";

			const endpoint = getProviderEndpoint(
				"google-vertex",
				undefined,
				"gemini-2.5-pro",
				"ya29.oauth-token",
				false,
				undefined,
				undefined,
				{ google_vertex_token_type: "api-key" },
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				"oauth", // vertexTokenType override
			);

			expect(endpoint).toBe(
				"https://aiplatform.googleapis.com/v1/projects/project-a/locations/global/publishers/google/models/gemini-2.5-pro:generateContent",
			);
		});
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

		it("routes Grok 4.3 through the Azure AI Foundry endpoint", () => {
			process.env.LLM_AZURE_AI_FOUNDRY_RESOURCE = "gkapitech";

			const endpoint = getProviderEndpoint(
				"azure-ai-foundry",
				undefined,
				"grok-4-3",
			);

			expect(endpoint).toBe(
				"https://gkapitech.services.ai.azure.com/models/chat/completions?api-version=2024-05-01-preview",
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

	describe("azure-anthropic", () => {
		it("builds the Microsoft Foundry Anthropic Messages endpoint", () => {
			process.env.LLM_AZURE_ANTHROPIC_RESOURCE = "llmg-us-east-2";

			const endpoint = getProviderEndpoint(
				"azure-anthropic",
				undefined,
				"claude-opus-4-8",
			);

			expect(endpoint).toBe(
				"https://llmg-us-east-2.services.ai.azure.com/anthropic/v1/messages",
			);
		});

		it("uses the same messages endpoint for streaming requests", () => {
			process.env.LLM_AZURE_ANTHROPIC_RESOURCE = "llmg-us-east-2";

			const endpoint = getProviderEndpoint(
				"azure-anthropic",
				undefined,
				"claude-sonnet-5",
				undefined,
				true,
			);

			expect(endpoint).toBe(
				"https://llmg-us-east-2.services.ai.azure.com/anthropic/v1/messages",
			);
		});

		it("prefers the resource from provider key options", () => {
			process.env.LLM_AZURE_ANTHROPIC_RESOURCE = "env-resource";

			const endpoint = getProviderEndpoint(
				"azure-anthropic",
				undefined,
				"claude-opus-5",
				undefined,
				false,
				undefined,
				undefined,
				{ azure_anthropic_resource: "byok-resource" },
			);

			expect(endpoint).toBe(
				"https://byok-resource.services.ai.azure.com/anthropic/v1/messages",
			);
		});

		it("uses the managed credential resource", () => {
			delete process.env.LLM_AZURE_ANTHROPIC_RESOURCE;

			const endpoint = getProviderEndpoint(
				"azure-anthropic",
				undefined,
				"claude-sonnet-5",
				undefined,
				false,
				undefined,
				undefined,
				{ env_config: { resource: "managed-resource" } },
				undefined,
				undefined,
				undefined,
				true,
			);

			expect(endpoint).toBe(
				"https://managed-resource.services.ai.azure.com/anthropic/v1/messages",
			);
		});

		it("throws when no resource is configured", () => {
			delete process.env.LLM_AZURE_ANTHROPIC_RESOURCE;

			expect(() =>
				getProviderEndpoint("azure-anthropic", undefined, "claude-opus-4-8"),
			).toThrow(/Azure Anthropic resource is required/);
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
			process.env.LLM_AZURE_ANTHROPIC_RESOURCE = resource;

			expect(() =>
				getProviderEndpoint("azure-anthropic", undefined, "claude-opus-4-8"),
			).toThrow(/Azure Anthropic resource (is invalid|is required)/);
		});
	});

	describe("xiaomi", () => {
		it("builds the default Xiaomi endpoint", () => {
			delete process.env.LLM_XIAOMI_BASE_URL;

			const endpoint = getProviderEndpoint(
				"xiaomi",
				undefined,
				"mimo-v2.5-pro",
			);

			expect(endpoint).toBe("https://api.xiaomimimo.com/v1/chat/completions");
		});

		it("uses custom base URL when provided", () => {
			const endpoint = getProviderEndpoint(
				"xiaomi",
				"https://custom-xiaomi.example.com",
				"mimo-v2-flash",
			);

			expect(endpoint).toBe(
				"https://custom-xiaomi.example.com/v1/chat/completions",
			);
		});

		it("builds streaming endpoint", () => {
			delete process.env.LLM_XIAOMI_BASE_URL;

			const endpoint = getProviderEndpoint(
				"xiaomi",
				undefined,
				"mimo-v2.5",
				undefined,
				true,
			);

			expect(endpoint).toBe("https://api.xiaomimimo.com/v1/chat/completions");
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

		it("ignores LLM_GOOGLE_VERTEX_TOKEN_TYPE env var when skipEnvVars is true", () => {
			process.env.LLM_GOOGLE_CLOUD_PROJECT = "project-a";
			process.env.LLM_GOOGLE_VERTEX_TOKEN_TYPE = "oauth";

			const endpoint = getProviderEndpoint(
				"google-vertex",
				undefined,
				"gemini-2.5-pro",
				"AIzaSyExample",
				false,
				undefined,
				undefined,
				undefined, // no providerKeyOptions
				undefined,
				undefined,
				undefined,
				true, // skipEnvVars
			);

			expect(endpoint).toContain("?key=AIzaSyExample");
		});

		it("uses hardcoded default for openai regardless of skipEnvVars", () => {
			process.env.LLM_OPENAI_BASE_URL = "http://localhost:8787/openai";

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
				{ google_vertex_project_id: "byok-project" },
				undefined,
				undefined,
				undefined,
				true, // skipEnvVars
			);

			expect(endpoint).toBe(
				"https://aiplatform.googleapis.com/v1/projects/byok-project/locations/global/publishers/google/models/gemini-2.5-flash-lite:generateContent",
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

		it("honors an anthropic credential base URL override", () => {
			const endpoint = getProviderEndpoint(
				"anthropic",
				undefined,
				"claude-opus-5",
				undefined,
				undefined,
				undefined,
				undefined,
				{ env_config: { baseUrl: "https://anthropic.example" } },
				undefined,
				undefined,
				undefined,
				true, // skipEnvVars
			);

			expect(endpoint).toBe("https://anthropic.example/v1/messages");
		});

		it("falls back to the anthropic default when no base URL is configured", () => {
			const endpoint = getProviderEndpoint(
				"anthropic",
				undefined,
				"claude-opus-5",
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

			expect(endpoint).toBe("https://api.anthropic.com/v1/messages");
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

	describe("aws-bedrock regions", () => {
		it("defaults to us-east-1 endpoint with global. prefix when no region is set", () => {
			const endpoint = getProviderEndpoint(
				"aws-bedrock",
				undefined,
				"anthropic.claude-haiku-4-5-20251001-v1:0",
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
				"https://bedrock-runtime.us-east-1.amazonaws.com/model/global.anthropic.claude-haiku-4-5-20251001-v1:0/converse",
			);
		});

		it("routes to eu-central-1 with eu. prefix when region is 'eu'", () => {
			const endpoint = getProviderEndpoint(
				"aws-bedrock",
				undefined,
				"anthropic.claude-haiku-4-5-20251001-v1:0",
				undefined,
				false,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				"eu",
				true,
			);

			expect(endpoint).toBe(
				"https://bedrock-runtime.eu-central-1.amazonaws.com/model/eu.anthropic.claude-haiku-4-5-20251001-v1:0/converse",
			);
		});

		it("routes to ap-northeast-1 with apac. prefix when region is 'apac'", () => {
			const endpoint = getProviderEndpoint(
				"aws-bedrock",
				undefined,
				"anthropic.claude-haiku-4-5-20251001-v1:0",
				undefined,
				true,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				"apac",
				true,
			);

			expect(endpoint).toBe(
				"https://bedrock-runtime.ap-northeast-1.amazonaws.com/model/apac.anthropic.claude-haiku-4-5-20251001-v1:0/converse-stream",
			);
		});

		it("uses us-east-1 endpoint with us. prefix when region is 'us'", () => {
			const endpoint = getProviderEndpoint(
				"aws-bedrock",
				undefined,
				"anthropic.claude-haiku-4-5-20251001-v1:0",
				undefined,
				false,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				"us",
				true,
			);

			expect(endpoint).toBe(
				"https://bedrock-runtime.us-east-1.amazonaws.com/model/us.anthropic.claude-haiku-4-5-20251001-v1:0/converse",
			);
		});

		it("routes to a specific AWS region with no inference profile prefix (data residency)", () => {
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
				"us-east-2",
				true,
			);

			expect(endpoint).toBe(
				"https://bedrock-runtime.us-east-2.amazonaws.com/model/anthropic.claude-3-5-sonnet-20241022-v2:0/converse",
			);
		});

		it("routes to eu-west-1 with no prefix for EU data residency", () => {
			const endpoint = getProviderEndpoint(
				"aws-bedrock",
				undefined,
				"anthropic.claude-3-5-sonnet-20241022-v2:0",
				undefined,
				true,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				"eu-west-1",
				true,
			);

			expect(endpoint).toBe(
				"https://bedrock-runtime.eu-west-1.amazonaws.com/model/anthropic.claude-3-5-sonnet-20241022-v2:0/converse-stream",
			);
		});

		it("lets aws_bedrock_region_prefix provider-key option override the region-derived prefix", () => {
			const endpoint = getProviderEndpoint(
				"aws-bedrock",
				undefined,
				"anthropic.claude-haiku-4-5-20251001-v1:0",
				undefined,
				false,
				undefined,
				undefined,
				{ aws_bedrock_region_prefix: "global." },
				undefined,
				undefined,
				"eu",
				true,
			);

			// Endpoint URL still follows the region, but the prefix is overridden
			expect(endpoint).toBe(
				"https://bedrock-runtime.eu-central-1.amazonaws.com/model/global.anthropic.claude-haiku-4-5-20251001-v1:0/converse",
			);
		});

		it("keeps an explicit env base URL over the region-derived endpoint", () => {
			process.env.LLM_AWS_BEDROCK_BASE_URL = "https://bedrock.proxy.internal";

			const endpoint = getProviderEndpoint(
				"aws-bedrock",
				undefined,
				"anthropic.claude-haiku-4-5-20251001-v1:0",
				undefined,
				false,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				"eu",
				false, // not BYOK — env vars apply
			);

			// Proxy/private base URL wins; the region only drives the model prefix.
			expect(endpoint).toBe(
				"https://bedrock.proxy.internal/model/eu.anthropic.claude-haiku-4-5-20251001-v1:0/converse",
			);
		});

		it("does not read LLM_AWS_BEDROCK_REGION for the prefix in BYOK mode", () => {
			process.env.LLM_AWS_BEDROCK_REGION = "us.";

			const endpoint = getProviderEndpoint(
				"aws-bedrock",
				undefined,
				"anthropic.claude-haiku-4-5-20251001-v1:0",
				undefined,
				false,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				true, // skipEnvVars (BYOK) — env region must be ignored
			);

			// Falls back to the hardcoded "global." prefix, not the env "us."
			expect(endpoint).toBe(
				"https://bedrock-runtime.us-east-1.amazonaws.com/model/global.anthropic.claude-haiku-4-5-20251001-v1:0/converse",
			);
		});

		it.each([
			{
				region: undefined,
				endpoint:
					"https://bedrock-mantle.us-west-2.api.aws/openai/v1/chat/completions",
			},
			{
				region: "global",
				endpoint:
					"https://bedrock-mantle.us-west-2.api.aws/openai/v1/chat/completions",
			},
			{
				region: "us",
				endpoint:
					"https://bedrock-mantle.us-west-2.api.aws/openai/v1/chat/completions",
			},
			{
				region: "us-west-2",
				endpoint:
					"https://bedrock-mantle.us-west-2.api.aws/openai/v1/chat/completions",
			},
		])(
			"routes Grok 4.3 through the Bedrock Mantle OpenAI endpoint for $region",
			({ region, endpoint: expectedEndpoint }) => {
				const endpoint = getProviderEndpoint(
					"aws-bedrock",
					undefined,
					"grok-4-3",
					undefined,
					false,
					undefined,
					undefined,
					undefined,
					undefined,
					undefined,
					region,
					true,
					"grok-4-3",
				);

				expect(endpoint).toBe(expectedEndpoint);
			},
		);

		it("keeps a custom Grok 4.3 Bedrock Mantle base URL", () => {
			const endpoint = getProviderEndpoint(
				"aws-bedrock",
				"https://bedrock-proxy.internal/openai/v1",
				"grok-4-3",
				undefined,
				false,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				"us-west-2",
				true,
				"grok-4-3",
			);

			expect(endpoint).toBe(
				"https://bedrock-proxy.internal/openai/v1/chat/completions",
			);
		});

		it("normalizes a long run of trailing base URL slashes", () => {
			const endpoint = getProviderEndpoint(
				"aws-bedrock",
				`https://bedrock-proxy.internal/openai/v1${"/".repeat(100_000)}`,
				"grok-4-3",
				undefined,
				false,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				"us-west-2",
				true,
				"grok-4-3",
			);

			expect(endpoint).toBe(
				"https://bedrock-proxy.internal/openai/v1/chat/completions",
			);
		});
	});

	describe("alibaba regions", () => {
		const callAlibaba = (
			region: string | undefined,
			providerKeyOptions?: Parameters<typeof getProviderEndpoint>[7],
		) =>
			getProviderEndpoint(
				"alibaba",
				undefined,
				"qwen3.7-max",
				undefined,
				false,
				undefined,
				undefined,
				providerKeyOptions,
				undefined,
				undefined,
				region,
				true, // skipEnvVars
			);

		it.each([
			{
				region: undefined,
				host: "https://dashscope-intl.aliyuncs.com",
			},
			{ region: "singapore", host: "https://dashscope-intl.aliyuncs.com" },
			{ region: "us-virginia", host: "https://dashscope-us.aliyuncs.com" },
			{ region: "cn-beijing", host: "https://dashscope.aliyuncs.com" },
		])("routes $region to its DashScope host", ({ region, host }) => {
			expect(callAlibaba(region)).toBe(
				`${host}/compatible-mode/v1/chat/completions`,
			);
		});

		it("builds the workspace-dedicated host for eu-frankfurt", () => {
			expect(
				callAlibaba("eu-frankfurt", { alibaba_workspace_id: "llm-abc123" }),
			).toBe(
				"https://llm-abc123.eu-central-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
			);
		});

		it("falls back to the shared entry point without a workspace id", () => {
			expect(callAlibaba("eu-frankfurt")).toBe(
				"https://trial.eu-central-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
			);
		});

		it("rejects a workspace id that is not a bare hostname label", () => {
			expect(() =>
				callAlibaba("eu-frankfurt", {
					alibaba_workspace_id: "evil.example.com/x",
				}),
			).toThrow(/workspace id is invalid/);
		});

		it("reads the workspace id from the region-specific env var", () => {
			process.env.LLM_ALIBABA_WORKSPACE_ID__EU_FRANKFURT = "llm-from-env";

			const endpoint = getProviderEndpoint(
				"alibaba",
				undefined,
				"qwen3.7-max",
				undefined,
				false,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				"eu-frankfurt",
			);

			expect(endpoint).toBe(
				"https://llm-from-env.eu-central-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
			);
		});

		it("prefers the variant-regional workspace id for matching orgs", () => {
			process.env.LLM_ALIBABA_WORKSPACE_ID__EU_FRANKFURT = "llm-shared";
			process.env.LLM_ALIBABA_WORKSPACE_ID__ENTERPRISE__EU_FRANKFURT =
				"llm-enterprise";

			const endpoint = getProviderEndpoint(
				"alibaba",
				undefined,
				"qwen3.7-max",
				undefined,
				false,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				"eu-frankfurt",
				undefined,
				undefined,
				undefined,
				"enterprise",
			);

			expect(endpoint).toBe(
				"https://llm-enterprise.eu-central-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
			);
		});

		it("selects the regional workspace id matching configIndex", () => {
			process.env.LLM_ALIBABA_WORKSPACE_ID__EU_FRANKFURT =
				"llm-first,llm-second";

			const endpoint = getProviderEndpoint(
				"alibaba",
				undefined,
				"qwen3.7-max",
				undefined,
				false,
				undefined,
				undefined,
				undefined,
				1, // configIndex
				undefined,
				"eu-frankfurt",
			);

			expect(endpoint).toBe(
				"https://llm-second.eu-central-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
			);
		});
	});

	describe("aws-mantle regions", () => {
		it.each([
			{ region: "us-east-1" },
			{ region: "us-east-2" },
			{ region: "us-west-2" },
		])("routes to the $region Mantle endpoint", ({ region }) => {
			const endpoint = getProviderEndpoint(
				"aws-mantle",
				undefined,
				"openai.gpt-5.6-terra",
				undefined,
				false,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				region,
				true,
			);

			expect(endpoint).toBe(
				`https://bedrock-mantle.${region}.api.aws/openai/v1/responses`,
			);
		});

		it("falls back to us-east-1 when no region is selected", () => {
			const endpoint = getProviderEndpoint(
				"aws-mantle",
				undefined,
				"openai.gpt-5.6-sol",
				undefined,
				false,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				true,
			);

			expect(endpoint).toBe(
				"https://bedrock-mantle.us-east-1.api.aws/openai/v1/responses",
			);
		});

		it("prefers the selected region over LLM_AWS_MANTLE_REGION", () => {
			// The env var is a deployment-level default; a region resolved from the
			// request or from a provider key's options must still win.
			process.env.LLM_AWS_MANTLE_REGION = "us-east-1";

			const endpoint = getProviderEndpoint(
				"aws-mantle",
				undefined,
				"openai.gpt-5.6-terra",
				undefined,
				false,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				"us-west-2",
				false, // read env vars
			);

			expect(endpoint).toBe(
				"https://bedrock-mantle.us-west-2.api.aws/openai/v1/responses",
			);
		});

		it("falls back to LLM_AWS_MANTLE_REGION when no region is selected", () => {
			process.env.LLM_AWS_MANTLE_REGION = "us-east-2";

			const endpoint = getProviderEndpoint(
				"aws-mantle",
				undefined,
				"openai.gpt-5.6-terra",
				undefined,
				false,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				false, // read env vars
			);

			expect(endpoint).toBe(
				"https://bedrock-mantle.us-east-2.api.aws/openai/v1/responses",
			);
		});

		it("keeps an explicit base URL over the region-derived endpoint", () => {
			const endpoint = getProviderEndpoint(
				"aws-mantle",
				"https://mantle-proxy.internal",
				"openai.gpt-5.6-luna",
				undefined,
				false,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				"us-west-2",
				true,
			);

			expect(endpoint).toBe(
				"https://mantle-proxy.internal/openai/v1/responses",
			);
		});
	});
});
