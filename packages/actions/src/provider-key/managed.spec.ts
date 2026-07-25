import { describe, expect, it } from "vitest";

import {
	getManagedCredentialConfigKeys,
	getMissingManagedCredentialKeys,
	getUnknownManagedCredentialKeys,
	managedCredentialOptions,
} from "./managed.js";

describe("getManagedCredentialConfigKeys", () => {
	it("lists a provider's settings without the API key itself", () => {
		const keys = getManagedCredentialConfigKeys("google-vertex");
		expect(keys.map((entry) => entry.key)).not.toContain("apiKey");
		expect(keys).toContainEqual({
			key: "project",
			envVar: "LLM_GOOGLE_CLOUD_PROJECT",
			required: true,
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
	it("reports required settings that are absent or blank", () => {
		expect(getMissingManagedCredentialKeys("google-vertex", {})).toEqual([
			"project",
		]);
		expect(
			getMissingManagedCredentialKeys("google-vertex", { project: "   " }),
		).toEqual(["project"]);
	});

	it("passes once every required setting is supplied", () => {
		expect(
			getMissingManagedCredentialKeys("google-vertex", { project: "my-proj" }),
		).toEqual([]);
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
