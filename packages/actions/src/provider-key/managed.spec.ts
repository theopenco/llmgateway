import { describe, expect, it } from "vitest";

import {
	getManagedCredentialConfigKeys,
	getMissingManagedCredentialKeys,
	getUnknownManagedCredentialKeys,
	managedCredentialOptions,
	managedCredentialValidationOptions,
} from "./managed.js";

describe("getManagedCredentialConfigKeys", () => {
	it("lists a provider's settings without the API key itself", () => {
		const keys = getManagedCredentialConfigKeys("google-vertex");
		expect(keys.map((entry) => entry.key)).not.toContain("apiKey");
		expect(keys).toContainEqual({
			key: "project",
			envVar: "LLM_GOOGLE_CLOUD_PROJECT",
			required: false,
		});
		expect(keys).toContainEqual({
			key: "region",
			envVar: "LLM_GOOGLE_VERTEX_REGION",
			required: false,
		});
	});

	it("returns nothing for an unknown provider", () => {
		expect(getManagedCredentialConfigKeys("not-a-provider")).toEqual([]);
	});
});

describe("getMissingManagedCredentialKeys", () => {
	it("does not require optional Vertex project settings", () => {
		expect(getMissingManagedCredentialKeys("google-vertex", {})).toEqual([]);
	});

	it("requires the base URL for providers whose endpoint comes from env", () => {
		expect(getMissingManagedCredentialKeys("glacier", {})).toEqual(["baseUrl"]);
	});

	it("requires nothing for providers with a static endpoint", () => {
		expect(getMissingManagedCredentialKeys("anthropic", {})).toEqual([]);
	});
});

describe("getUnknownManagedCredentialKeys", () => {
	it("rejects settings the provider does not declare", () => {
		expect(
			getUnknownManagedCredentialKeys("anthropic", { project: "x" }),
		).toEqual(["project"]);
	});

	it("accepts declared settings", () => {
		expect(
			getUnknownManagedCredentialKeys("google-vertex", {
				project: "x",
				region: "global",
			}),
		).toEqual([]);
	});

	it("never treats the API key as a config setting", () => {
		expect(getUnknownManagedCredentialKeys("openai", { apiKey: "sk" })).toEqual(
			["apiKey"],
		);
	});
});

describe("managedCredentialOptions", () => {
	it("returns undefined when there is no credential", () => {
		expect(managedCredentialOptions(undefined)).toBeUndefined();
		expect(managedCredentialOptions(null)).toBeUndefined();
	});

	it("surfaces the config column as env_config", () => {
		expect(
			managedCredentialOptions({
				options: null,
				config: { project: "my-proj", region: "us-central1" },
			}),
		).toEqual({
			env_config: { project: "my-proj", region: "us-central1" },
		});
	});

	it("keeps existing typed options alongside the config", () => {
		expect(
			managedCredentialOptions({
				options: { azure_deployment_name: "gpt-4o" },
				config: { resource: "my-resource" },
			}),
		).toEqual({
			azure_deployment_name: "gpt-4o",
			env_config: { resource: "my-resource" },
		});
	});

	it("leaves options untouched when the config is empty", () => {
		expect(
			managedCredentialOptions({
				options: { azure_deployment_name: "gpt-4o" },
				config: {},
			}),
		).toEqual({ azure_deployment_name: "gpt-4o" });
	});
});

describe("managedCredentialValidationOptions", () => {
	it("carries the credential's config as env_config", () => {
		expect(
			managedCredentialValidationOptions(
				"google-vertex",
				{ project: "my-proj" },
				null,
			),
		).toEqual({ env_config: { project: "my-proj" } });
	});

	it("bridges the region column onto the provider's region option key", () => {
		expect(
			managedCredentialValidationOptions("aws-bedrock", {}, "eu-central-1"),
		).toEqual({ aws_bedrock_region: "eu-central-1" });
	});

	it("prefers the config's own region over the region column", () => {
		expect(
			managedCredentialValidationOptions(
				"aws-bedrock",
				{ region: "us-west-2" },
				"eu-central-1",
			),
		).toEqual({
			env_config: { region: "us-west-2" },
			aws_bedrock_region: "us-west-2",
		});
	});

	it("ignores a blank region column", () => {
		expect(
			managedCredentialValidationOptions("aws-bedrock", {}, "   "),
		).toEqual({});
	});

	it("leaves the region out for providers that are not region-scoped", () => {
		expect(
			managedCredentialValidationOptions("openai", {}, "eu-central-1"),
		).toEqual({});
	});
});
