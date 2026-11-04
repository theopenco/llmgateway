import { afterEach, describe, expect, it } from "vitest";

import {
	getAzureCredentialBaseUrl,
	getAzureUpstreamModel,
	getCredentialSetting,
} from "./resolve-platform-credential.js";

import type { InferSelectModel, tables } from "@llmgateway/db";

type ProviderKeyRow = InferSelectModel<typeof tables.providerKey>;

function row(config?: Record<string, string>): ProviderKeyRow {
	return { id: "key-id", config: config ?? null } as unknown as ProviderKeyRow;
}

afterEach(() => {
	delete process.env.LLM_OPENAI_BASE_URL;
	delete process.env.LLM_GOOGLE_CLOUD_PROJECT;
	delete process.env.LLM_AZURE_RESOURCE;
});

describe("getCredentialSetting", () => {
	it("reads the env var on the env-credential path", () => {
		process.env.LLM_OPENAI_BASE_URL = "https://proxy.example.com";
		expect(getCredentialSetting("openai", "baseUrl", {})).toBe(
			"https://proxy.example.com",
		);
	});

	it("never reads env for a BYOK key", () => {
		process.env.LLM_OPENAI_BASE_URL = "https://proxy.example.com";
		process.env.LLM_GOOGLE_CLOUD_PROJECT = "platform-project";
		expect(
			getCredentialSetting("openai", "baseUrl", { providerKey: row() }),
		).toBeUndefined();
		expect(
			getCredentialSetting("google-vertex", "project", {
				providerKey: row(),
			}),
		).toBeUndefined();
		expect(
			getCredentialSetting(
				"google-vertex",
				"region",
				{ providerKey: row() },
				{ defaultValue: "global" },
			),
		).toBe("global");
	});

	it("reads a managed credential's own config, never env", () => {
		process.env.LLM_OPENAI_BASE_URL = "https://proxy.example.com";
		expect(
			getCredentialSetting("openai", "baseUrl", {
				managedKey: row({ baseUrl: "https://managed.example.com" }),
			}),
		).toBe("https://managed.example.com");
		expect(
			getCredentialSetting("openai", "baseUrl", { managedKey: row() }),
		).toBeUndefined();
	});
});

function azureKey(options: Record<string, string>): ProviderKeyRow {
	return {
		id: "azure-key",
		baseUrl: null,
		config: null,
		options,
	} as unknown as ProviderKeyRow;
}

describe("getAzureCredentialBaseUrl", () => {
	it("prefers a BYOK key's resource over the env resource", () => {
		process.env.LLM_AZURE_RESOURCE = "platform-resource";
		expect(
			getAzureCredentialBaseUrl({
				providerKey: azureKey({ azure_resource: "org-resource" }),
			}),
		).toBe("https://org-resource.openai.azure.com");
		expect(getAzureCredentialBaseUrl({})).toBe(
			"https://platform-resource.openai.azure.com",
		);
	});
});

describe("getAzureUpstreamModel", () => {
	it("uses azure_deployment_name when set", () => {
		expect(
			getAzureUpstreamModel(
				{ providerKey: azureKey({ azure_deployment_name: "my-embed" }) },
				"text-embedding-3-small",
			),
		).toBe("my-embed");
	});

	it("falls back to the mapping's external id", () => {
		expect(
			getAzureUpstreamModel(
				{ providerKey: azureKey({}) },
				"text-embedding-3-small",
			),
		).toBe("text-embedding-3-small");
		expect(getAzureUpstreamModel({}, "gpt-4o-mini-tts")).toBe(
			"gpt-4o-mini-tts",
		);
	});
});
