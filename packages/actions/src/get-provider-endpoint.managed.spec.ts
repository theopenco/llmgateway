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
	"LLM_AZURE_DEPLOYMENT_TYPE",
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
