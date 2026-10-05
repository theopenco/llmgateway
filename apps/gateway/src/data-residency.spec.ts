import { beforeAll, describe, expect, test } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { resolveDynamicRouteClassification } from "./chat/tools/resolve-dynamic-route-classification.js";
import {
	assertResidencyAllowsBaseUrl,
	getRequestDataResidency,
	isBaseUrlOverride,
	isProviderIdCompliant,
	withRequestDataResidency,
} from "./lib/compliance.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";

describe("data residency", () => {
	const harness = createGatewayApiTestHarness();
	let mockServerUrl = "";

	beforeAll(() => {
		mockServerUrl = harness.mockServerUrl;
	});

	async function seedKeys() {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});
		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			...encryptProviderKeyForStorage(
				"sk-test-key",
				"provider-key-id",
				"org-id",
			),
			provider: "llmgateway",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});
	}

	function chat(body: unknown, headers: Record<string, string> = {}) {
		return app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
				...headers,
			},
			body: JSON.stringify(body),
		});
	}

	test("EU residency header blocks providers outside the EU", async () => {
		await seedKeys();
		await db.insert(tables.providerKey).values({
			id: "openai-key-id",
			...encryptProviderKeyForStorage("sk-test-key", "openai-key-id", "org-id"),
			provider: "openai",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});
		const blocked = await chat(
			{
				model: "openai/gpt-4o-mini",
				messages: [{ role: "user", content: "hi from the EU" }],
			},
			{ "x-llmgateway-data-residency": "eu" },
		);
		expect(blocked.status).toBe(403);
		expect(await blocked.text()).toContain("data residency");

		const invalid = await chat(
			{
				model: "openai/gpt-4o-mini",
				messages: [{ role: "user", content: "hi" }],
			},
			{ "x-llmgateway-data-residency": "mars" },
		);
		expect(invalid.status).toBe(400);
	});

	test("EU residency does not route a multi-region mapping to its default region", async () => {
		await seedKeys();
		await db.insert(tables.providerKey).values({
			id: "alibaba-key-id",
			...encryptProviderKeyForStorage(
				"sk-test-key",
				"alibaba-key-id",
				"org-id",
			),
			provider: "alibaba",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});
		for (const model of ["alibaba/qwen-plus", "qwen-plus"]) {
			const res = await chat(
				{ model, messages: [{ role: "user", content: `eu only ${model}` }] },
				{ "x-llmgateway-data-residency": "eu", "x-no-fallback": "true" },
			);
			expect(res.status).toBe(403);
		}
	});

	test("residency blocks a pinned qualifying endpoint behind a custom base URL", async () => {
		await seedKeys();
		// The harness key's baseUrl replaces Alibaba's Frankfurt endpoint.
		await db.insert(tables.providerKey).values({
			id: "alibaba-key-id",
			...encryptProviderKeyForStorage(
				"sk-test-key",
				"alibaba-key-id",
				"org-id",
			),
			provider: "alibaba",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});
		const res = await chat(
			{
				model: "alibaba/qwen-plus:eu-frankfurt",
				messages: [{ role: "user", content: "eu endpoint via custom url" }],
			},
			{ "x-llmgateway-data-residency": "eu", "x-no-fallback": "true" },
		);
		expect(res.status).toBe(403);
	});

	test("US residency header blocks providers without a verified US endpoint", async () => {
		await seedKeys();
		await db.insert(tables.providerKey).values({
			id: "openai-key-id",
			...encryptProviderKeyForStorage("sk-test-key", "openai-key-id", "org-id"),
			provider: "openai",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});
		const blocked = await chat(
			{
				model: "openai/gpt-4o-mini",
				messages: [{ role: "user", content: "hi from the US" }],
			},
			{ "x-llmgateway-data-residency": "us" },
		);
		expect(blocked.status).toBe(403);
	});

	test("the header is honoured outside chat completions", async () => {
		await seedKeys();
		await db.insert(tables.providerKey).values({
			id: "openai-key-id",
			...encryptProviderKeyForStorage("sk-test-key", "openai-key-id", "org-id"),
			provider: "openai",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});
		const embeddings = await app.request("/v1/embeddings", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
				"x-llmgateway-data-residency": "eu",
			},
			body: JSON.stringify({
				model: "openai/text-embedding-3-small",
				input: "hello",
			}),
		});
		expect(embeddings.status).toBe(403);
		const invalid = await app.request("/v1/embeddings", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
				"x-llmgateway-data-residency": "mars",
			},
			body: JSON.stringify({
				model: "openai/text-embedding-3-small",
				input: "hello",
			}),
		});
		expect(invalid.status).toBe(400);
	});

	test("org EU residency policy blocks providers outside the EU", async () => {
		await seedKeys();
		await db.insert(tables.providerKey).values({
			id: "openai-key-id",
			...encryptProviderKeyForStorage("sk-test-key", "openai-key-id", "org-id"),
			provider: "openai",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});
		await db
			.update(tables.organization)
			.set({ providerCompliancePolicy: { enabled: true, dataResidency: "eu" } })
			.where(eq(tables.organization.id, "org-id"));
		const res = await chat({
			model: "openai/gpt-4o-mini",
			messages: [{ role: "user", content: "policy check" }],
		});
		expect(res.status).toBe(403);
	});
});

describe("residency with regional endpoints", () => {
	const eu = { enabled: true, dataResidency: "eu" as const };
	const us = { enabled: true, dataResidency: "us" as const };
	test("qualifies on the verified processing region of the endpoint", () => {
		expect(
			isProviderIdCompliant("alibaba", eu, { region: "eu-frankfurt" }),
		).toBe(true);
		expect(
			isProviderIdCompliant("alibaba", us, { region: "us-virginia" }),
		).toBe(true);
		expect(
			isProviderIdCompliant("alibaba", eu, { region: "us-virginia" }),
		).toBe(false);
		expect(isProviderIdCompliant("alibaba", eu)).toBe(false);
		expect(isProviderIdCompliant("mistral", eu)).toBe(true);
		expect(isProviderIdCompliant("mistral", us)).toBe(false);
	});
	test("headquarters never qualify a provider", () => {
		expect(isProviderIdCompliant("openai", us)).toBe(false);
		expect(isProviderIdCompliant("nebius", eu)).toBe(false);
		expect(isProviderIdCompliant("aws-bedrock", us, { region: "global" })).toBe(
			false,
		);
		expect(isProviderIdCompliant("aws-bedrock", us, { region: "us" })).toBe(
			true,
		);
	});
	test("a mapping's own claim overrides the endpoint", () => {
		expect(
			isProviderIdCompliant("aws-bedrock", us, {
				region: "us-east-1",
				mapping: { processingRegion: "global" },
			}),
		).toBe(false);
	});
	test("a request residency also blocks the dynamic-route classifier", async () => {
		const result = await resolveDynamicRouteClassification({
			organization: { id: "org-id", plan: "enterprise" },
			dataResidency: "eu",
			context: {} as never,
			sessionStickyEnabled: false,
			routingCfg: {} as never,
			messages: [{ role: "user", content: "hi" }],
			hasImages: false,
		});
		expect(result).toBeNull();
	});
});

describe("base URL overrides", () => {
	test("anything but the catalogue endpoints counts as an override", () => {
		expect(isBaseUrlOverride("openai", undefined)).toBe(false);
		expect(isBaseUrlOverride("openai", "https://api.openai.com")).toBe(false);
		expect(isBaseUrlOverride("openai", "https://api.openai.com/")).toBe(false);
		expect(isBaseUrlOverride("openai", "https://proxy.example.com")).toBe(true);
		expect(
			isBaseUrlOverride(
				"aws-bedrock",
				"https://bedrock-runtime.eu-central-1.amazonaws.com",
			),
		).toBe(false);
		expect(
			isBaseUrlOverride(
				"alibaba",
				"https://trial.eu-central-1.maas.aliyuncs.com",
			),
		).toBe(false);
	});
	test("only matters under a residency requirement", async () => {
		const context = { organizationId: "org-id", modelId: "gpt-4o-mini" };
		await expect(
			assertResidencyAllowsBaseUrl(
				{ enabled: true },
				"openai",
				"https://proxy.example.com",
				context,
			),
		).resolves.toBeUndefined();
		await expect(
			assertResidencyAllowsBaseUrl(
				{ enabled: true, dataResidency: "us" },
				"openai",
				"https://proxy.example.com",
				context,
			),
		).rejects.toMatchObject({ status: 403 });
	});
});

describe("request data residency", () => {
	test("reads the header only", () => {
		expect(getRequestDataResidency("EU")).toBe("eu");
		expect(getRequestDataResidency(" us ")).toBe("us");
		expect(getRequestDataResidency(undefined)).toBe(undefined);
		expect(() => getRequestDataResidency("mars")).toThrow();
		expect(() => getRequestDataResidency("")).toThrow();
	});

	test("only tightens the org policy", () => {
		expect(withRequestDataResidency(undefined, undefined)).toBe(undefined);
		expect(withRequestDataResidency(undefined, "eu")).toEqual({
			enabled: true,
			dataResidency: "eu",
		});
		expect(
			withRequestDataResidency({ enabled: true, requireSoc2: true }, "eu"),
		).toEqual({ enabled: true, requireSoc2: true, dataResidency: "eu" });
		expect(() =>
			withRequestDataResidency({ enabled: true, dataResidency: "eu" }, "us"),
		).toThrow();
	});
});
