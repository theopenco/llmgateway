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
import { requestLogs, waitForLogs } from "./test-utils/test-helpers.js";

import type { SmartRoutingConfig } from "@llmgateway/shared/smart-routing";

// Cheapest to priciest on their OpenAI mappings, so the configured list splits
// into one model per difficulty band.
const CHEAP_MODEL = "gpt-4.1-nano";
const MID_MODEL = "gpt-4o-mini";
const EXPENSIVE_MODEL = "gpt-4o";

const THREE_MODELS = [EXPENSIVE_MODEL, CHEAP_MODEL, MID_MODEL];

describe("smart routing", () => {
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
			plan?: "free" | "pro" | "enterprise";
			orgConfig?: SmartRoutingConfig | null;
			projectConfig?: SmartRoutingConfig | null;
			classifierCredential?: boolean;
			providers?: string[];
		} = {},
	) {
		await db
			.update(tables.organization)
			.set({ plan, smartRoutingConfig: orgConfig ?? null })
			.where(eq(tables.organization.id, "org-id"));
		await db
			.update(tables.project)
			.set({ smartRoutingConfig: projectConfig ?? null })
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

	async function chatCompletion(
		token: string,
		body: Record<string, unknown>,
		headers: Record<string, string> = {},
	) {
		return await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
				...headers,
			},
			body: JSON.stringify(body),
		});
	}

	test("a hard request is served from the top price band", async () => {
		const token = await seedBase("hard", {
			orgConfig: { classifier: "jev", models: THREE_MODELS },
		});

		const res = await chatCompletion(token, {
			model: "smart",
			messages: [
				{ role: "user", content: "HARD_TASK design a distributed scheduler" },
			],
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.model).toBe(`openai/${EXPENSIVE_MODEL}`);

		// Two rows: the classifier call is billed on its own.
		const logs = requestLogs(await waitForLogs(2));
		const smartRouting = logs[0]?.routingMetadata?.smartRouting;
		expect(smartRouting).toMatchObject({
			classifier: "jev",
			difficulty: "high",
			band: "high",
			selectedModel: EXPENSIVE_MODEL,
			classifierFailed: false,
		});
		expect(smartRouting?.eligibleModels).toEqual(THREE_MODELS);
		// Candidates are recorded cheapest first, which is the band order.
		expect(smartRouting?.candidateModels).toEqual([
			CHEAP_MODEL,
			MID_MODEL,
			EXPENSIVE_MODEL,
		]);
	});

	test("the classifier call is billed to the calling project", async () => {
		const token = await seedBase("billing", {
			orgConfig: { classifier: "jev", models: THREE_MODELS },
		});

		const res = await chatCompletion(token, {
			model: "smart",
			messages: [
				{ role: "user", content: "HARD_TASK design a distributed scheduler" },
			],
		});
		expect(res.status).toBe(200);

		const logs = await waitForLogs(2);
		const classifierLog = logs.find((log) => log.usedProvider === "typesafe");
		expect(classifierLog).toBeDefined();
		expect(classifierLog).toMatchObject({
			organizationId: "org-id",
			projectId: "project-id",
			apiKeyId: `token-ar-billing`,
			usedModel: "typesafe/jev-1.13.0",
			requestedModel: "smart",
			// The classifier runs on a platform credential, so the organization
			// pays credits for it whatever mode the project is in.
			usedMode: "credits",
			promptTokens: "441",
			hasError: false,
			routingBaselineCost: null,
		});
		// 441 input tokens at the catalogue rate; output is priced at zero.
		expect(Number(classifierLog?.cost)).toBeCloseTo(441 * 0.042e-6, 12);

		const requestLog = requestLogs(logs)[0];
		expect(
			requestLog?.routingMetadata?.smartRouting?.classifierCost,
		).toBeCloseTo(441 * 0.042e-6, 12);
	});

	test("an easy request is served from the bottom price band", async () => {
		const token = await seedBase("easy", {
			orgConfig: { classifier: "jev", models: THREE_MODELS },
		});

		const res = await chatCompletion(token, {
			model: "smart",
			messages: [{ role: "user", content: "EASY_TASK say hi" }],
		});
		expect(res.status).toBe(200);
		expect((await res.json()).model).toBe(`openai/${CHEAP_MODEL}`);

		const logs = requestLogs(await waitForLogs(2));
		expect(logs[0]?.routingMetadata?.smartRouting).toMatchObject({
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
			model: "smart",
			messages: [{ role: "user", content: "CLASSIFIER_ERROR hard question" }],
		});
		expect(res.status).toBe(200);
		expect((await res.json()).model).toBe(`openai/${CHEAP_MODEL}`);

		const logs = await waitForLogs(1);
		expect(logs[0]?.routingMetadata?.smartRouting).toMatchObject({
			classifier: "jev",
			classifierFailed: true,
			selectedModel: CHEAP_MODEL,
		});
		expect(logs[0]?.routingMetadata?.smartRouting?.difficulty).toBeUndefined();
	});

	test('classifier "none" always picks the cheapest candidate', async () => {
		const token = await seedBase("none", {
			orgConfig: { classifier: "none", models: THREE_MODELS },
		});

		const res = await chatCompletion(token, {
			model: "smart",
			messages: [
				{ role: "user", content: "HARD_TASK design a distributed scheduler" },
			],
		});
		expect(res.status).toBe(200);
		expect((await res.json()).model).toBe(`openai/${CHEAP_MODEL}`);

		const logs = await waitForLogs(1);
		expect(logs[0]?.routingMetadata?.smartRouting).toMatchObject({
			classifier: "none",
			selectedModel: CHEAP_MODEL,
			classifierFailed: false,
		});
		expect(logs[0]?.routingMetadata?.smartRouting?.difficulty).toBeUndefined();
		// Priced against the priciest configured model it could have picked.
		expect(logs[0]?.routingBaselineModel).toBe(`openai/${EXPENSIVE_MODEL}`);
		expect(Number(logs[0]?.routingBaselineCost)).toBeGreaterThan(
			Number(logs[0]?.cost),
		);
	});

	test("a project override beats the organization default", async () => {
		const token = await seedBase("override", {
			orgConfig: { classifier: "none", models: [EXPENSIVE_MODEL] },
			projectConfig: { classifier: "none", models: [MID_MODEL] },
		});

		const res = await chatCompletion(token, {
			model: "smart",
			messages: [{ role: "user", content: "hi override" }],
		});
		expect(res.status).toBe(200);
		expect((await res.json()).model).toBe(`openai/${MID_MODEL}`);
	});

	test('"auto" ignores the configuration entirely', async () => {
		// The whole point of the split: existing auto callers keep the built-in
		// candidate set and never pay for a classifier, however the org is
		// configured.
		const token = await seedBase("legacy-auto", {
			orgConfig: { classifier: "jev", models: THREE_MODELS },
		});

		const res = await chatCompletion(token, {
			model: "auto",
			messages: [
				{ role: "user", content: "HARD_TASK design a distributed scheduler" },
			],
		});
		expect(res.status).toBe(200);
		// A built-in model, not one of the configured OpenAI models.
		expect((await res.json()).model).toContain("claude");

		const logs = await waitForLogs(1);
		expect(logs[0]?.routingMetadata?.smartRouting).toBeUndefined();
		expect(logs[0]?.routingBaselineModel).toBe("anthropic/claude-opus-4-6");
	});

	test("a pay-as-you-go organization can use smart routing", async () => {
		const token = await seedBase("payg", {
			plan: "free",
			orgConfig: { classifier: "none", models: [MID_MODEL] },
		});

		const res = await chatCompletion(token, {
			model: "smart",
			messages: [{ role: "user", content: "hi payg" }],
		});
		expect(res.status).toBe(200);
		expect((await res.json()).model).toBe(`openai/${MID_MODEL}`);
	});

	test("DevPass organizations are rejected", async () => {
		const token = await seedBase("devpass", {
			orgConfig: { classifier: "none", models: [MID_MODEL] },
		});
		await cdb
			.update(tables.organization)
			.set({ kind: "devpass" })
			.where(eq(tables.organization.id, "org-id"));

		const res = await chatCompletion(token, {
			model: "smart",
			messages: [{ role: "user", content: "hi devpass" }],
		});
		expect(res.status).toBe(403);
		expect((await res.json()).error.message).toContain("not available");

		// The harness re-seeds per test, but the kind is cached by the gateway's
		// organization lookup, so put it back rather than leaking devpass into
		// the next test's cached read.
		await cdb
			.update(tables.organization)
			.set({ kind: "default" })
			.where(eq(tables.organization.id, "org-id"));
	});

	test("an unconfigured organization is told to configure it", async () => {
		// Never degrade quietly into the built-in "auto" set: a caller that asked
		// for their own models and silently got ours cannot notice.
		const token = await seedBase("unconfigured");

		const res = await chatCompletion(token, {
			model: "smart",
			messages: [{ role: "user", content: "hi unconfigured" }],
		});
		expect(res.status).toBe(400);
		expect((await res.json()).error.message).toContain("not configured");
	});

	test("fails with 400 when no configured model can serve the request", async () => {
		const token = await seedBase("nocandidate", {
			orgConfig: { classifier: "none", models: [CHEAP_MODEL, MID_MODEL] },
		});

		const res = await chatCompletion(token, {
			model: "smart",
			messages: [{ role: "user", content: "think hard" }],
			reasoning_effort: "high",
		});
		expect(res.status).toBe(400);
		expect((await res.json()).error.message).toContain(
			"configured smart-routing models",
		);
	});

	test("a sticky session classifies once and reuses the verdict", async () => {
		const token = await seedBase("sticky", {
			orgConfig: { classifier: "jev", models: THREE_MODELS },
		});
		const sessionId = "session-auto-routing-reuse";

		const first = await chatCompletion(
			token,
			{
				model: "smart",
				messages: [
					{ role: "user", content: "HARD_TASK design a distributed scheduler" },
				],
			},
			{ "x-session-id": sessionId },
		);
		expect(first.status).toBe(200);
		expect((await first.json()).model).toBe(`openai/${EXPENSIVE_MODEL}`);

		// An easy follow-up on the same session must not be re-rated: it stays on
		// the model the session already resolved to, keeping the upstream prompt
		// cache warm and skipping the classifier round trip entirely.
		const second = await chatCompletion(
			token,
			{
				model: "smart",
				messages: [{ role: "user", content: "EASY_TASK and now say hi" }],
			},
			{ "x-session-id": sessionId },
		);
		expect(second.status).toBe(200);
		expect((await second.json()).model).toBe(`openai/${EXPENSIVE_MODEL}`);

		// Partitioned rather than ordered: both rows land in the same millisecond,
		// so createdAt does not separate them.
		// Three rows: two requests, plus the single classifier call the opening
		// turn was billed for.
		const decisions = requestLogs(await waitForLogs(3)).map(
			(log) => log.routingMetadata?.smartRouting,
		);
		const classified = decisions.filter((d) => !d?.classifierReused);
		const reused = decisions.filter((d) => d?.classifierReused);
		expect(classified).toHaveLength(1);
		expect(reused).toHaveLength(1);

		expect(classified[0]).toMatchObject({
			difficulty: "high",
			selectedModel: EXPENSIVE_MODEL,
		});
		expect(classified[0]?.classifierLatencyMs).toBeGreaterThanOrEqual(0);

		expect(reused[0]).toMatchObject({
			difficulty: "high",
			selectedModel: EXPENSIVE_MODEL,
		});
		// No call was made on the reused turn, so there is no latency to record.
		expect(reused[0]?.classifierLatencyMs).toBeUndefined();
	});

	test("a work scan upgrades a session between turns when the work gets harder", async () => {
		const token = await seedBase("sticky-scan", {
			orgConfig: { classifier: "jev", models: THREE_MODELS },
		});
		const sessionId = "session-auto-routing-scan";
		const turn = async (content: string) => {
			const res = await chatCompletion(
				token,
				{ model: "smart", messages: [{ role: "user", content }] },
				{ "x-session-id": sessionId },
			);
			expect(res.status).toBe(200);
			return res;
		};

		const opening = await turn("EASY_TASK rename a variable");
		expect((await opening.json()).model).toBe(`openai/${CHEAP_MODEL}`);
		expect(opening.headers.get("x-llmgateway-smart-model")).toBe(CHEAP_MODEL);
		expect(opening.headers.get("x-llmgateway-smart-change")).toBeNull();

		// Follow-ups before the scan is due keep the choice without a check,
		// however hard they look.
		for (let index = 0; index < 3; index++) {
			const followUp = await turn("HARD_TASK CHOOSE:harder follow-up");
			expect((await followUp.json()).model).toBe(`openai/${CHEAP_MODEL}`);
		}

		const scanned = await turn("HARD_TASK CHOOSE:harder design a scheduler");
		expect((await scanned.json()).model).toBe(`openai/${EXPENSIVE_MODEL}`);
		expect(scanned.headers.get("x-llmgateway-smart-change")).toContain(
			"the work became harder",
		);

		// Five requests plus two billed classifier calls: the opening turn and
		// the scan.
		const decisions = requestLogs(await waitForLogs(7)).map(
			(log) => log.routingMetadata?.smartRouting,
		);
		expect(decisions.map((decision) => decision?.trigger).sort()).toEqual([
			"initial",
			"reused",
			"reused",
			"reused",
			"scan",
		]);
		expect(
			decisions.find((decision) => decision?.trigger === "scan"),
		).toMatchObject({
			workChange: "harder",
			selectedModel: EXPENSIVE_MODEL,
			switch: {
				fromModel: CHEAP_MODEL,
				toModel: EXPENSIVE_MODEL,
				direction: "upgrade",
				reason: "harder-work",
			},
		});
	});

	test("a different session classifies independently", async () => {
		const token = await seedBase("sticky-separate", {
			orgConfig: { classifier: "jev", models: THREE_MODELS },
		});

		const first = await chatCompletion(
			token,
			{
				model: "smart",
				messages: [
					{ role: "user", content: "HARD_TASK design a distributed scheduler" },
				],
			},
			{ "x-session-id": "session-one" },
		);
		expect((await first.json()).model).toBe(`openai/${EXPENSIVE_MODEL}`);

		const second = await chatCompletion(
			token,
			{
				model: "smart",
				messages: [{ role: "user", content: "EASY_TASK say hi" }],
			},
			{ "x-session-id": "session-two" },
		);
		expect((await second.json()).model).toBe(`openai/${CHEAP_MODEL}`);
	});

	test("classifies every request when no session is supplied", async () => {
		const token = await seedBase("no-session", {
			orgConfig: { classifier: "jev", models: THREE_MODELS },
		});

		const first = await chatCompletion(token, {
			model: "smart",
			messages: [
				{ role: "user", content: "HARD_TASK design a distributed scheduler" },
			],
		});
		expect((await first.json()).model).toBe(`openai/${EXPENSIVE_MODEL}`);

		const second = await chatCompletion(token, {
			model: "smart",
			messages: [{ role: "user", content: "EASY_TASK say hi" }],
		});
		expect((await second.json()).model).toBe(`openai/${CHEAP_MODEL}`);
	});

	// gpt-5-nano < gpt-5-mini < o4-mini on price, and all three support
	// reasoning, so a hard verdict lands on o4-mini and exercises the default
	// reasoning effort that auto routing applies.
	const REASONING_MODELS = ["gpt-5-nano", "gpt-5-mini", "o4-mini"];

	async function upstreamEffortForHardRequest(
		suffix: string,
		maxTokens: number,
	) {
		const token = await seedBase(suffix, {
			orgConfig: { classifier: "jev", models: REASONING_MODELS },
		});

		const res = await chatCompletion(token, {
			model: "smart",
			max_tokens: maxTokens,
			messages: [
				{ role: "user", content: "HARD_TASK design a distributed scheduler" },
			],
		});
		expect(res.status).toBe(200);
		expect((await res.json()).model).toBe("openai/o4-mini");

		const log = requestLogs(await waitForLogs(2))[0];
		expect(log?.routingMetadata?.smartRouting?.difficulty).toBe("high");
		return (log?.upstreamRequest as { reasoning_effort?: string } | null)
			?.reasoning_effort;
	}

	test("a hard request gets a real thinking budget when there is room", async () => {
		expect(await upstreamEffortForHardRequest("effort-room", 16_000)).toBe(
			"medium",
		);
	});

	test("a hard request keeps the cheap effort on a tight token budget", async () => {
		// Thinking is drawn from the same max_tokens allowance as the answer, so
		// raising the default here returns empty content on exactly the hardest
		// requests — measured against a real provider before this guard existed.
		expect(await upstreamEffortForHardRequest("effort-tight", 1_000)).toBe(
			"low",
		);
	});

	test("free_models_only cannot escape the configured list", async () => {
		// The list is a governance boundary: a request parameter must not be able
		// to route to a free catalogue model the organization never allowed.
		const token = await seedBase("free-escape", {
			orgConfig: { classifier: "none", models: THREE_MODELS },
		});

		const res = await chatCompletion(token, {
			model: "smart",
			messages: [{ role: "user", content: "hi free" }],
			free_models_only: true,
		});
		expect(res.status).toBe(400);
		expect((await res.json()).error.message).toContain(
			"configured smart-routing models are free",
		);
	});

	test("free_models_only narrows the configured list to its free models", async () => {
		const token = await seedBase("free-narrow", {
			orgConfig: {
				classifier: "none",
				models: [MID_MODEL, "claude-haiku-4-5-free"],
			},
		});

		const res = await chatCompletion(token, {
			model: "smart",
			messages: [{ role: "user", content: "hi free narrow" }],
			free_models_only: true,
		});
		expect(res.status).toBe(200);
		expect((await res.json()).model).toContain("claude-haiku-4-5-free");
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
			model: "smart",
			messages: [
				{ role: "user", content: "HARD_TASK design a distributed scheduler" },
			],
		});
		expect(res.status).toBe(200);
		expect((await res.json()).model).toBe(`openai/${CHEAP_MODEL}`);

		const logs = await waitForLogs(1);
		expect(logs[0]?.routingMetadata?.smartRouting).toMatchObject({
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
			model: "smart",
			messages: [
				{ role: "user", content: "HARD_TASK design a distributed scheduler" },
			],
		});
		expect(res.status).toBe(200);
		expect((await res.json()).model).toBe(`openai/${CHEAP_MODEL}`);

		const logs = await waitForLogs(1);
		// Not a failure: the classifier was never attempted.
		expect(logs[0]?.routingMetadata?.smartRouting).toMatchObject({
			classifier: "jev",
			classifierFailed: false,
			selectedModel: CHEAP_MODEL,
		});
	});
});
