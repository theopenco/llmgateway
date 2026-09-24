import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { cdb, db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import { waitForLogs } from "./test-utils/test-helpers.js";

import type { AutoRoutingConfig } from "@llmgateway/shared/auto-routing";

// Cheapest to priciest on their OpenAI mappings, so the configured list splits
// into one model per difficulty band.
const CHEAP_MODEL = "gpt-4.1-nano";
const MID_MODEL = "gpt-4o-mini";
const EXPENSIVE_MODEL = "gpt-4o";

const THREE_MODELS = [EXPENSIVE_MODEL, CHEAP_MODEL, MID_MODEL];

describe("configurable auto routing", () => {
	const harness = createGatewayApiTestHarness();
	let mockServerUrl = "";
	// The gateway's own classifier credential is a platform credential, so an
	// LLM_* value left in the developer .env would send these tests upstream.
	const originalTypesafeKey = process.env.LLM_TYPESAFE_API_KEY;

	beforeAll(() => {
		mockServerUrl = harness.mockServerUrl;
	});

	beforeEach(() => {
		delete process.env.LLM_TYPESAFE_API_KEY;
	});

	afterAll(() => {
		if (originalTypesafeKey !== undefined) {
			process.env.LLM_TYPESAFE_API_KEY = originalTypesafeKey;
		}
	});

	async function seedBase(
		suffix: string,
		{
			plan = "enterprise",
			orgConfig,
			projectConfig,
			classifierCredential = true,
			providers = ["openai", "anthropic"],
		}: {
			plan?: "pro" | "enterprise";
			orgConfig?: AutoRoutingConfig | null;
			projectConfig?: AutoRoutingConfig | null;
			classifierCredential?: boolean;
			providers?: string[];
		} = {},
	) {
		await db
			.update(tables.organization)
			.set({ plan, autoRoutingConfig: orgConfig ?? null })
			.where(eq(tables.organization.id, "org-id"));
		await db
			.update(tables.project)
			.set({ autoRoutingConfig: projectConfig ?? null })
			.where(eq(tables.project.id, "project-id"));

		await db.insert(tables.apiKey).values({
			id: `token-ar-${suffix}`,
			...hashApiKeyForStorage(`real-token-ar-${suffix}`),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values(
			providers.map((provider) => ({
				id: `pk-ar-${provider}-${suffix}`,
				...encryptProviderKeyForStorage(
					`sk-${provider}-test-key`,
					`pk-ar-${provider}-${suffix}`,
					"org-id",
				),
				provider,
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			})),
		);

		if (classifierCredential) {
			// Platform-managed, like the real deployment: the classifier never runs
			// on the organization's own credential.
			await cdb.insert(tables.providerKey).values({
				id: `pk-ar-typesafe-${suffix}`,
				...encryptProviderKeyForStorage(
					"ts-test-key",
					`pk-ar-typesafe-${suffix}`,
					null,
				),
				provider: "typesafe",
				organizationId: null,
				managed: true,
				config: { baseUrl: mockServerUrl },
			});
		}

		return `real-token-ar-${suffix}`;
	}

	async function chatCompletion(token: string, body: Record<string, unknown>) {
		return await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify(body),
		});
	}

	test("a hard request is served from the top price band", async () => {
		const token = await seedBase("hard", {
			orgConfig: { classifier: "jev", models: THREE_MODELS },
		});

		const res = await chatCompletion(token, {
			model: "auto",
			messages: [
				{ role: "user", content: "HARD_TASK design a distributed scheduler" },
			],
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.model).toBe(`openai/${EXPENSIVE_MODEL}`);

		const logs = await waitForLogs(1);
		const autoRouting = logs[0]?.routingMetadata?.autoRouting;
		expect(autoRouting).toMatchObject({
			classifier: "jev",
			difficulty: "high",
			band: "high",
			selectedModel: EXPENSIVE_MODEL,
			classifierFailed: false,
		});
		expect(autoRouting?.eligibleModels).toEqual(THREE_MODELS);
		// Candidates are recorded cheapest first, which is the band order.
		expect(autoRouting?.candidateModels).toEqual([
			CHEAP_MODEL,
			MID_MODEL,
			EXPENSIVE_MODEL,
		]);
	});

	test("an easy request is served from the bottom price band", async () => {
		const token = await seedBase("easy", {
			orgConfig: { classifier: "jev", models: THREE_MODELS },
		});

		const res = await chatCompletion(token, {
			model: "auto",
			messages: [{ role: "user", content: "EASY_TASK say hi" }],
		});
		expect(res.status).toBe(200);
		expect((await res.json()).model).toBe(`openai/${CHEAP_MODEL}`);

		const logs = await waitForLogs(1);
		expect(logs[0]?.routingMetadata?.autoRouting).toMatchObject({
			difficulty: "low",
			band: "low",
			selectedModel: CHEAP_MODEL,
		});
	});

	test("a failing classifier falls back to the cheapest candidate", async () => {
		const token = await seedBase("failopen", {
			orgConfig: { classifier: "jev", models: THREE_MODELS },
		});

		const res = await chatCompletion(token, {
			model: "auto",
			messages: [{ role: "user", content: "CLASSIFIER_ERROR hard question" }],
		});
		expect(res.status).toBe(200);
		expect((await res.json()).model).toBe(`openai/${CHEAP_MODEL}`);

		const logs = await waitForLogs(1);
		expect(logs[0]?.routingMetadata?.autoRouting).toMatchObject({
			classifier: "jev",
			classifierFailed: true,
			selectedModel: CHEAP_MODEL,
		});
		expect(logs[0]?.routingMetadata?.autoRouting?.difficulty).toBeUndefined();
	});

	test('classifier "none" always picks the cheapest candidate', async () => {
		const token = await seedBase("none", {
			orgConfig: { classifier: "none", models: THREE_MODELS },
		});

		const res = await chatCompletion(token, {
			model: "auto",
			messages: [
				{ role: "user", content: "HARD_TASK design a distributed scheduler" },
			],
		});
		expect(res.status).toBe(200);
		expect((await res.json()).model).toBe(`openai/${CHEAP_MODEL}`);

		const logs = await waitForLogs(1);
		expect(logs[0]?.routingMetadata?.autoRouting).toMatchObject({
			classifier: "none",
			selectedModel: CHEAP_MODEL,
			classifierFailed: false,
		});
		expect(logs[0]?.routingMetadata?.autoRouting?.difficulty).toBeUndefined();
	});

	test("a project override beats the organization default", async () => {
		const token = await seedBase("override", {
			orgConfig: { classifier: "none", models: [EXPENSIVE_MODEL] },
			projectConfig: { classifier: "none", models: [MID_MODEL] },
		});

		const res = await chatCompletion(token, {
			model: "auto",
			messages: [{ role: "user", content: "hi override" }],
		});
		expect(res.status).toBe(200);
		expect((await res.json()).model).toBe(`openai/${MID_MODEL}`);
	});

	test("a non-enterprise organization ignores a stored configuration", async () => {
		const token = await seedBase("plan", {
			plan: "pro",
			orgConfig: { classifier: "none", models: [MID_MODEL] },
		});

		const res = await chatCompletion(token, {
			model: "auto",
			messages: [{ role: "user", content: "hi plan" }],
		});
		expect(res.status).toBe(200);
		// The built-in candidate set, not the stored (unlicensed) configuration.
		expect((await res.json()).model).toContain("claude");

		const logs = await waitForLogs(1);
		expect(logs[0]?.routingMetadata?.autoRouting).toBeUndefined();
	});

	test("fails with 400 when no configured model can serve the request", async () => {
		const token = await seedBase("nocandidate", {
			orgConfig: { classifier: "none", models: [CHEAP_MODEL, MID_MODEL] },
		});

		const res = await chatCompletion(token, {
			model: "auto",
			messages: [{ role: "user", content: "think hard" }],
			reasoning_effort: "high",
		});
		expect(res.status).toBe(400);
		expect((await res.json()).error.message).toContain(
			"configured auto-routing models",
		);
	});

	test("skips the classifier when the policy blocks its provider", async () => {
		const token = await seedBase("compliance", {
			orgConfig: { classifier: "jev", models: THREE_MODELS },
		});
		// The classifier would send prompt text to TypeSafe, so a policy that
		// blocks that provider must stop the call, not just the inference route.
		await db
			.update(tables.organization)
			.set({
				providerCompliancePolicy: {
					enabled: true,
					blockedProviders: ["typesafe"],
				},
			})
			.where(eq(tables.organization.id, "org-id"));

		const res = await chatCompletion(token, {
			model: "auto",
			messages: [
				{ role: "user", content: "HARD_TASK design a distributed scheduler" },
			],
		});
		expect(res.status).toBe(200);
		expect((await res.json()).model).toBe(`openai/${CHEAP_MODEL}`);

		const logs = await waitForLogs(1);
		expect(logs[0]?.routingMetadata?.autoRouting).toMatchObject({
			classifier: "jev",
			classifierFailed: false,
			selectedModel: CHEAP_MODEL,
		});
	});

	test("skips the classifier when no credential is configured", async () => {
		const token = await seedBase("nocred", {
			orgConfig: { classifier: "jev", models: THREE_MODELS },
			classifierCredential: false,
		});

		const res = await chatCompletion(token, {
			model: "auto",
			messages: [
				{ role: "user", content: "HARD_TASK design a distributed scheduler" },
			],
		});
		expect(res.status).toBe(200);
		expect((await res.json()).model).toBe(`openai/${CHEAP_MODEL}`);

		const logs = await waitForLogs(1);
		// Not a failure: the classifier was never attempted.
		expect(logs[0]?.routingMetadata?.autoRouting).toMatchObject({
			classifier: "jev",
			classifierFailed: false,
			selectedModel: CHEAP_MODEL,
		});
	});
});
