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
import { semanticCacheText } from "./lib/semantic-cache-embedding.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import { waitForLogs } from "./test-utils/test-helpers.js";

describe("enterprise controls", () => {
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

	async function seedPrompt() {
		await db.insert(tables.prompt).values({
			id: "prompt-id",
			organizationId: "org-id",
			projectId: "project-id",
			name: "support-reply",
			productionVersion: 1,
			latestVersion: 2,
		});
		await db.insert(tables.promptVersion).values([
			{
				promptId: "prompt-id",
				version: 1,
				messages: [
					{ role: "system", content: "You support {{product}}." },
					{ role: "user", content: "Explain {{topic}} briefly." },
				],
				model: "llmgateway/custom",
				parameters: { temperature: 0.2 },
				variables: ["product", "topic"],
			},
			{
				promptId: "prompt-id",
				version: 2,
				messages: [{ role: "user", content: "Draft v2 about {{topic}}." }],
				model: "llmgateway/custom",
				variables: ["topic"],
			},
		]);
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

	test("expands the production prompt version with variables", async () => {
		await seedKeys();
		await seedPrompt();
		const res = await chat({
			prompt: {
				id: "support-reply",
				variables: { product: "LLM Gateway", topic: "fallbacks" },
			},
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("x-llmgateway-prompt-id")).toBe("prompt-id");
		expect(res.headers.get("x-llmgateway-prompt-version")).toBe("1");
		const json = await res.json();
		expect(json.choices[0].message.content).toMatch(
			/Explain fallbacks briefly/,
		);
		const logs = await waitForLogs(1);
		expect(JSON.stringify(logs[0].messages)).toContain(
			"You support LLM Gateway.",
		);
		expect(logs[0].temperature).toBe(0.2);
	});

	test("pins a version and appends caller messages", async () => {
		await seedKeys();
		await seedPrompt();
		const res = await chat({
			prompt: { id: "prompt-id", version: 2, variables: { topic: "caching" } },
			messages: [{ role: "user", content: "Then list three tips." }],
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("x-llmgateway-prompt-version")).toBe("2");
		const logs = await waitForLogs(1);
		const sent = JSON.stringify(logs[0].messages);
		expect(sent.indexOf("Draft v2 about caching.")).toBeLessThan(
			sent.indexOf("Then list three tips."),
		);
	});

	test("rejects missing variables, unknown prompts and bad keys", async () => {
		await seedKeys();
		await seedPrompt();
		const missing = await chat({ prompt: { id: "support-reply" } });
		expect(missing.status).toBe(400);
		expect(await missing.text()).toContain("Missing prompt variables");

		const unknown = await chat({ prompt: { id: "nope" } });
		expect(unknown.status).toBe(404);

		const badKey = await chat(
			{ prompt: { id: "support-reply" } },
			{ Authorization: "Bearer wrong-token" },
		);
		expect(badKey.status).toBe(401);
	});

	test("does not resolve another project's prompt", async () => {
		await seedKeys();
		await seedPrompt();
		await db.insert(tables.project).values({
			id: "other-project",
			name: "Other",
			organizationId: "org-id",
			mode: "api-keys",
		});
		await db
			.update(tables.prompt)
			.set({ projectId: "other-project" })
			.where(eq(tables.prompt.id, "prompt-id"));
		const res = await chat({
			prompt: { id: "prompt-id", variables: { product: "x", topic: "y" } },
		});
		expect(res.status).toBe(404);
	});

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

describe("semantic cache text", () => {
	test("embeds recent text turns with roles", () => {
		expect(
			semanticCacheText([
				{ role: "system", content: "Be brief." },
				{
					role: "user",
					content: [{ type: "text", text: "What is LLM routing?" }],
				},
			]),
		).toBe("system: Be brief.\nuser: What is LLM routing?");
	});

	test("skips requests with non-text content", () => {
		expect(
			semanticCacheText([
				{
					role: "user",
					content: [
						{ type: "text", text: "Describe" },
						{
							type: "image_url",
							image_url: { url: "https://example.com/a.png" },
						},
					],
				},
			]),
		).toBe(null);
	});
});
