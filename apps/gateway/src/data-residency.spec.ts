import { beforeAll, describe, expect, test } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { resolveDynamicRouteClassification } from "./chat/tools/resolve-dynamic-route-classification.js";
import {
	getRequestDataResidency,
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

	test("EU residency blocks a pinned EU endpoint behind a custom base URL", async () => {
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
	const policy = { enabled: true, dataResidency: "eu" as const };
	test("an EU regional endpoint of a non-EU provider is compliant", () => {
		expect(
			isProviderIdCompliant("alibaba", policy, { region: "eu-frankfurt" }),
		).toBe(true);
		expect(
			isProviderIdCompliant("alibaba", policy, { region: "us-virginia" }),
		).toBe(false);
		expect(isProviderIdCompliant("alibaba", policy)).toBe(false);
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

describe("request data residency", () => {
	test("reads the header and regional hostnames", () => {
		expect(getRequestDataResidency("EU", undefined)).toBe("eu");
		expect(getRequestDataResidency(undefined, "eu.api.llmgateway.io")).toBe(
			"eu",
		);
		expect(getRequestDataResidency(undefined, "api.llmgateway.io")).toBe(
			undefined,
		);
		expect(getRequestDataResidency(undefined, "localhost:4001")).toBe(
			undefined,
		);
		expect(() => getRequestDataResidency("us", undefined)).toThrow();
		expect(() => getRequestDataResidency("", undefined)).toThrow();
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
	});
});
