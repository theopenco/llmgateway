import { afterEach, describe, expect, it } from "vitest";

import { getProviderEndpoint } from "./get-provider-endpoint.js";
import { managedCredentialOptions } from "./provider-key/managed.js";

const ENV_VARS = [
	"LLM_GLACIER_BASE_URL",
	"LLM_GOOGLE_CLOUD_PROJECT",
	"LLM_GOOGLE_VERTEX_REGION",
	"LLM_GOOGLE_VERTEX_TOKEN_TYPE",
	"LLM_OPENAI_BASE_URL",
	"LLM_AZURE_RESOURCE",
	"LLM_AZURE_BASE_URL",
	"LLM_AZURE_DEPLOYMENT_TYPE",
	"LLM_VERTEX_ANTHROPIC_REGION",
	"LLM_VERTEX_ANTHROPIC_BASE_URL",
	"LLM_VERTEX_ANTHROPIC_PROJECT",
] as const;

const originals = new Map(ENV_VARS.map((name) => [name, process.env[name]]));

afterEach(() => {
	for (const [name, value] of originals) {
		if (value === undefined) {
			// eslint-disable-next-line @typescript-eslint/no-dynamic-delete
			delete process.env[name];
		} else {
			process.env[name] = value;
		}
	}
});

/** Endpoint resolution for a credential whose settings come from the database. */
function managed(config: Record<string, string>) {
	return managedCredentialOptions({ options: null, config });
}

describe("managed credential config in getProviderEndpoint", () => {
	it("supplies a base URL the deployment has no env var for", () => {
		delete process.env.LLM_GLACIER_BASE_URL;

		const url = getProviderEndpoint(
			"glacier",
			undefined,
			"gemini-2.0-flash",
			undefined,
			false,
			false,
			false,
			managed({ baseUrl: "https://glacier.managed.example" }),
			0,
			false,
			undefined,
			true,
		);

		expect(url).toBe(
			"https://glacier.managed.example/v1beta/models/gemini-2.0-flash:generateContent",
		);
	});

	it("wins over an env var that is also set", () => {
		process.env.LLM_OPENAI_BASE_URL = "https://openai.from-env.example";

		const url = getProviderEndpoint(
			"openai",
			undefined,
			"gpt-4o-mini",
			undefined,
			false,
			false,
			false,
			managed({ baseUrl: "https://openai.managed.example" }),
			0,
			false,
			undefined,
			true,
		);

		expect(url).toBe("https://openai.managed.example/v1/chat/completions");
	});

	it("carries the Google Vertex project and region", () => {
		delete process.env.LLM_GOOGLE_CLOUD_PROJECT;
		delete process.env.LLM_GOOGLE_VERTEX_REGION;

		const url = getProviderEndpoint(
			"google-vertex",
			undefined,
			"gemini-2.5-flash",
			"vertex-token",
			false,
			false,
			false,
			managed({ project: "managed-project", region: "us-central1" }),
			0,
			false,
			undefined,
			true,
		);

		expect(url).toContain("/projects/managed-project/locations/us-central1/");
		expect(url).toContain("key=vertex-token");
	});

	it("supports a managed Vertex API key without a project", () => {
		process.env.LLM_GOOGLE_CLOUD_PROJECT = "unrelated-env-project";
		process.env.LLM_GOOGLE_VERTEX_REGION = "us-central1";

		const url = getProviderEndpoint(
			"google-vertex",
			undefined,
			"gemini-2.5-flash",
			"vertex-token",
			false,
			false,
			false,
			managed({ baseUrl: "https://vertex.managed.example" }),
			0,
			false,
			undefined,
			true,
		);

		expect(url).toBe(
			"https://vertex.managed.example/v1/publishers/google/models/gemini-2.5-flash:generateContent?key=vertex-token",
		);
	});

	it("suppresses the API-key query param when the token type is oauth", () => {
		delete process.env.LLM_GOOGLE_VERTEX_TOKEN_TYPE;

		const url = getProviderEndpoint(
			"google-vertex",
			undefined,
			"gemini-2.5-flash",
			"vertex-token",
			false,
			false,
			false,
			managed({ project: "managed-project", tokenType: "oauth" }),
			0,
			false,
			undefined,
			true,
		);

		expect(url).not.toContain("key=vertex-token");
	});

	it("carries the Azure resource and deployment type", () => {
		delete process.env.LLM_AZURE_RESOURCE;
		delete process.env.LLM_AZURE_DEPLOYMENT_TYPE;

		const url = getProviderEndpoint(
			"azure",
			undefined,
			"gpt-4o-mini",
			undefined,
			false,
			false,
			false,
			managed({
				resource: "managed-resource",
				deploymentType: "openai",
				apiVersion: "2025-01-01",
			}),
			0,
			false,
			undefined,
			true,
		);

		expect(url).toBe(
			"https://managed-resource.openai.azure.com/openai/deployments/gpt-4o-mini/chat/completions?api-version=2025-01-01",
		);
	});

	it("reaches an Azure deployment that is not on azure.com via a base URL", () => {
		delete process.env.LLM_AZURE_RESOURCE;
		delete process.env.LLM_AZURE_BASE_URL;
		delete process.env.LLM_AZURE_DEPLOYMENT_TYPE;

		const url = getProviderEndpoint(
			"azure",
			undefined,
			"gpt-4o-mini",
			undefined,
			false,
			false,
			false,
			managed({
				baseUrl: "https://azure.example.internal",
				deploymentType: "openai",
				apiVersion: "2025-01-01",
			}),
			0,
			false,
			undefined,
			true,
		);

		expect(url).toBe(
			"https://azure.example.internal/openai/deployments/gpt-4o-mini/chat/completions?api-version=2025-01-01",
		);
	});

	it("prefers the Azure base URL over a resource when both are supplied", () => {
		delete process.env.LLM_AZURE_RESOURCE;
		delete process.env.LLM_AZURE_BASE_URL;
		delete process.env.LLM_AZURE_DEPLOYMENT_TYPE;

		const url = getProviderEndpoint(
			"azure",
			undefined,
			"gpt-4o-mini",
			undefined,
			false,
			false,
			false,
			managed({
				resource: "managed-resource",
				baseUrl: "https://azure.example.internal",
				deploymentType: "openai",
			}),
			0,
			false,
			undefined,
			true,
		);

		expect(url).toContain("https://azure.example.internal/");
		expect(url).not.toContain("managed-resource");
	});

	it("rejects an Azure credential carrying neither a resource nor a base URL", () => {
		delete process.env.LLM_AZURE_RESOURCE;
		delete process.env.LLM_AZURE_BASE_URL;

		expect(() =>
			getProviderEndpoint(
				"azure",
				undefined,
				"gpt-4o-mini",
				undefined,
				false,
				false,
				false,
				managed({ deploymentType: "openai" }),
				0,
				false,
				undefined,
				true,
			),
		).toThrow(/resource or a base URL/);
	});

	it("keeps the Vertex Anthropic host and path on the same region", () => {
		delete process.env.LLM_VERTEX_ANTHROPIC_REGION;
		delete process.env.LLM_VERTEX_ANTHROPIC_BASE_URL;

		const url = getProviderEndpoint(
			"vertex-anthropic",
			undefined,
			"claude-sonnet-4-6",
			JSON.stringify({ project_id: "managed-project" }),
			false,
			false,
			false,
			managed({ region: "us-east5" }),
			0,
			false,
			undefined,
			true,
		);

		expect(url).toBe(
			"https://us-east5-aiplatform.googleapis.com/v1/projects/managed-project/locations/us-east5/publishers/anthropic/models/claude-sonnet-4-6:rawPredict",
		);
	});

	it("takes the Vertex Anthropic project from the credential, not the env", () => {
		process.env.LLM_VERTEX_ANTHROPIC_PROJECT = "env-project";
		delete process.env.LLM_VERTEX_ANTHROPIC_REGION;
		delete process.env.LLM_VERTEX_ANTHROPIC_BASE_URL;

		const url = getProviderEndpoint(
			"vertex-anthropic",
			undefined,
			"claude-sonnet-4-6",
			// The credential's service-account JSON is already an access token by
			// the time the request is built, so nothing is derivable from it.
			undefined,
			false,
			false,
			false,
			managed({ project: "managed-project", region: "us-east5" }),
			0,
			false,
			undefined,
			true,
		);

		expect(url).toBe(
			"https://us-east5-aiplatform.googleapis.com/v1/projects/managed-project/locations/us-east5/publishers/anthropic/models/claude-sonnet-4-6:rawPredict",
		);
	});

	it("leaves env-var resolution alone when no managed credential is active", () => {
		process.env.LLM_OPENAI_BASE_URL = "https://openai.from-env.example";

		const url = getProviderEndpoint(
			"openai",
			undefined,
			"gpt-4o-mini",
			undefined,
			false,
			false,
			false,
			undefined,
			0,
			false,
			undefined,
			false,
		);

		expect(url).toBe("https://openai.from-env.example/v1/chat/completions");
	});
});
