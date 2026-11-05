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

describe("getAzureCredentialBaseUrl base URL precedence", () => {
	afterEach(() => {
		delete process.env.LLM_AZURE_BASE_URL;
	});

	it("uses a BYOK key's base URL over its resource", () => {
		expect(
			getAzureCredentialBaseUrl({
				providerKey: {
					...azureKey({ azure_resource: "org-resource" }),
					baseUrl: "https://byok.example.com/",
				} as ProviderKeyRow,
			}),
		).toBe("https://byok.example.com");
	});

	it("uses a managed credential's base URL over its resource and the env", () => {
		process.env.LLM_AZURE_RESOURCE = "platform-resource";
		expect(
			getAzureCredentialBaseUrl({
				managedKey: {
					id: "managed",
					config: {
						baseUrl: "https://managed.example.com",
						resource: "managed-resource",
					},
					options: null,
				} as unknown as ProviderKeyRow,
			}),
		).toBe("https://managed.example.com");
	});

	it("does not fall back to env settings for a managed credential", () => {
		process.env.LLM_AZURE_BASE_URL = "https://env.example.com";
		expect(
			getAzureCredentialBaseUrl({
				managedKey: {
					id: "managed",
					config: { resource: "managed-resource" },
					options: null,
				} as unknown as ProviderKeyRow,
			}),
		).toBe("https://managed-resource.openai.azure.com");
	});

	it("uses LLM_AZURE_BASE_URL over LLM_AZURE_RESOURCE on the env path", () => {
		process.env.LLM_AZURE_RESOURCE = "platform-resource";
		process.env.LLM_AZURE_BASE_URL = "https://env.example.com";
		expect(getAzureCredentialBaseUrl({})).toBe("https://env.example.com");
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
