import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";
import { readAll, waitForLogByRequestId } from "@/test-utils/test-helpers.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";
import { GATEWAY_CONTENT_FILTER_MESSAGE } from "@llmgateway/shared";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

const MODERATION_URL = "https://api.openai.com/v1/moderations";

interface ModerationResult {
	flagged: boolean;
	category_scores: Record<string, number>;
}

describe("tiered gateway content filter", () => {
	const harness = createGatewayApiTestHarness();
	let mockServerUrl: string;
	let previousOpenAIKey: string | undefined;
	let previousContentFilterMode: string | undefined;
	let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;
	let moderationCalls = 0;
	let moderationResponse: () => Response = () => new Response("{}");

	beforeAll(() => {
		mockServerUrl = harness.mockServerUrl;
	});

	beforeEach(async () => {
		previousOpenAIKey = process.env.LLM_OPENAI_API_KEY;
		previousContentFilterMode = process.env.LLM_CONTENT_FILTER_MODE;
		process.env.LLM_OPENAI_API_KEY = "sk-openai-test";
		delete process.env.LLM_CONTENT_FILTER_MODE;
		moderationCalls = 0;

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

		const originalFetch = globalThis.fetch;
		fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async (input, init) => {
				const url =
					typeof input === "string"
						? input
						: input instanceof URL
							? input.toString()
							: input.url;
				if (url === MODERATION_URL) {
					moderationCalls += 1;
					return moderationResponse();
				}
				return await originalFetch(input as RequestInfo | URL, init);
			});
	});

	afterEach(() => {
		fetchSpy?.mockRestore();
		fetchSpy = null;
		if (previousOpenAIKey === undefined) {
			delete process.env.LLM_OPENAI_API_KEY;
		} else {
			process.env.LLM_OPENAI_API_KEY = previousOpenAIKey;
		}
		if (previousContentFilterMode === undefined) {
			delete process.env.LLM_CONTENT_FILTER_MODE;
		} else {
			process.env.LLM_CONTENT_FILTER_MODE = previousContentFilterMode;
		}
	});

	function moderation(results: ModerationResult[]) {
		moderationResponse = () =>
			new Response(
				JSON.stringify({
					id: "modr-tiered",
					model: "omni-moderation-latest",
					results,
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
	}

	const violent: ModerationResult[] = [
		{ flagged: true, category_scores: { violence: 0.95, hate: 0.1 } },
	];
	const borderline: ModerationResult[] = [
		{ flagged: false, category_scores: { violence: 0.6 } },
	];

	async function chat(requestId: string, extra: Record<string, unknown> = {}) {
		return await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
				"x-request-id": requestId,
			},
			body: JSON.stringify({
				model: "llmgateway/custom",
				messages: [{ role: "user", content: `Tell me a story ${requestId}` }],
				...extra,
			}),
		});
	}

	test("skips moderation when the provider is not enabled", async () => {
		moderation(violent);
		await harness.setContentFilterSettings({ providerIds: ["openai"] });

		const res = await chat("tier-provider-off");
		expect(res.status).toBe(200);
		expect((await res.json()).choices[0].finish_reason).toBe("stop");
		expect(moderationCalls).toBe(0);

		const log = await waitForLogByRequestId("tier-provider-off");
		expect(log.gatewayContentFilterEvaluation).toBeNull();
	});

	test("records violations as metadata only by default", async () => {
		moderation(violent);
		await harness.setContentFilterSettings({ providerIds: ["llmgateway"] });

		const res = await chat("tier-log-only");
		expect(res.status).toBe(200);
		expect((await res.json()).choices[0].finish_reason).toBe("stop");
		expect(moderationCalls).toBe(1);

		const log = await waitForLogByRequestId("tier-log-only");
		expect(log.finishReason).not.toBe("llmgateway_content_filter");
		expect(log.internalContentFilter).toBe(true);
		expect(log.gatewayContentFilterEvaluation).toEqual({
			sampled: true,
			provider: "llmgateway",
			tier: 0,
			overridden: false,
			level: "strict",
			violation: true,
			action: "logged",
			enforced: false,
			exemptReason: "global_log_only",
			flagged: true,
			matchedCategories: ["violence"],
			categoryScores: { violence: 0.95, hate: 0.1 },
			moderationFailed: false,
		});
		expect(log.gatewayContentFilterResponse).toEqual([
			{
				id: "modr-tiered",
				model: "omni-moderation-latest",
				results: violent,
			},
		]);
	});

	test("blocks a strict-tier violation when enforcement is on", async () => {
		moderation(violent);
		await harness.setContentFilterSettings({
			providerIds: ["llmgateway"],
			enforce: true,
		});

		const res = await chat("tier-block");
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.choices[0].finish_reason).toBe("content_filter");
		expect(json.choices[0].message.content).toBe(
			GATEWAY_CONTENT_FILTER_MESSAGE,
		);
		expect(moderationCalls).toBe(1);

		const log = await waitForLogByRequestId("tier-block");
		expect(log.finishReason).toBe("llmgateway_content_filter");
		expect(log.unifiedFinishReason).toBe("content_filter");
		expect(log.hasError).toBe(false);
		expect(log.internalContentFilter).toBe(true);
		expect(log.gatewayContentFilterEvaluation).toMatchObject({
			action: "blocked",
			enforced: true,
			matchedCategories: ["violence"],
		});
	});

	test("streams the block as a single content_filter chunk", async () => {
		moderation(violent);
		await harness.setContentFilterSettings({
			providerIds: ["llmgateway"],
			enforce: true,
		});

		const res = await chat("tier-block-stream", { stream: true });
		expect(res.status).toBe(200);
		const { chunks, hasValidSSE } = await readAll(res.body);
		expect(hasValidSSE).toBe(true);
		expect(chunks).toHaveLength(1);
		expect(chunks[0].choices[0].finish_reason).toBe("content_filter");
		expect(chunks[0].choices[0].delta.content).toBe(
			GATEWAY_CONTENT_FILTER_MESSAGE,
		);
	});

	test("an inherited lenient tier passes a borderline score", async () => {
		moderation(borderline);
		await harness.setTrustTierOverride(3);
		await harness.setContentFilterSettings({
			providerIds: ["llmgateway"],
			enforce: true,
		});

		const res = await chat("tier-lenient-pass");
		expect((await res.json()).choices[0].finish_reason).toBe("stop");

		const log = await waitForLogByRequestId("tier-lenient-pass");
		expect(log.internalContentFilter).not.toBe(true);
		expect(log.gatewayContentFilterEvaluation).toMatchObject({
			tier: 3,
			overridden: false,
			level: "lenient",
			violation: false,
			action: "passed",
		});
		expect(log.gatewayContentFilterResponse).toHaveLength(1);
	});

	test("a content filter pin wins over the trust tier pin", async () => {
		moderation(borderline);
		await harness.setTrustTierOverride(4);
		await harness.setContentFilterTierOverride(0);
		await harness.setContentFilterSettings({
			providerIds: ["llmgateway"],
			enforce: true,
		});

		const res = await chat("tier-pin-block");
		expect((await res.json()).choices[0].finish_reason).toBe("content_filter");

		const log = await waitForLogByRequestId("tier-pin-block");
		expect(log.gatewayContentFilterEvaluation).toMatchObject({
			tier: 0,
			overridden: true,
			action: "blocked",
		});
	});

	test("enterprise organizations are logged, not blocked, unless enforced", async () => {
		moderation(violent);
		await harness.setOrganizationPlan("enterprise");
		await harness.setContentFilterSettings({
			providerIds: ["llmgateway"],
			enforce: true,
		});

		const served = await chat("tier-enterprise-logged");
		expect((await served.json()).choices[0].finish_reason).toBe("stop");
		const servedLog = await waitForLogByRequestId("tier-enterprise-logged");
		expect(servedLog.gatewayContentFilterEvaluation).toMatchObject({
			action: "logged",
			exemptReason: "enterprise",
		});

		await harness.setContentFilterSettings({
			providerIds: ["llmgateway"],
			enforce: true,
			enforceEnterprise: true,
		});
		const blocked = await chat("tier-enterprise-blocked");
		expect((await blocked.json()).choices[0].finish_reason).toBe(
			"content_filter",
		);
	});

	test("log-only organizations are never blocked", async () => {
		moderation(violent);
		await harness.setContentFilterLogOnly(true);
		await harness.setContentFilterSettings({
			providerIds: ["llmgateway"],
			enforce: true,
		});

		const res = await chat("tier-org-log-only");
		expect((await res.json()).choices[0].finish_reason).toBe("stop");
		const log = await waitForLogByRequestId("tier-org-log-only");
		expect(log.gatewayContentFilterEvaluation).toMatchObject({
			action: "logged",
			exemptReason: "org_log_only",
		});
	});

	test("a zero sample rate never calls moderation", async () => {
		moderation(violent);
		await harness.setContentFilterSettings({
			providerIds: ["llmgateway"],
			sampleRatePercent: 0,
			enforce: true,
		});

		const res = await chat("tier-sample-zero");
		expect((await res.json()).choices[0].finish_reason).toBe("stop");
		expect(moderationCalls).toBe(0);
	});

	test("fails open when the moderation API errors", async () => {
		moderationResponse = () =>
			new Response(JSON.stringify({ error: "down" }), { status: 500 });
		await harness.setContentFilterSettings({
			providerIds: ["llmgateway"],
			enforce: true,
		});

		const res = await chat("tier-fail-open");
		expect(res.status).toBe(200);
		expect((await res.json()).choices[0].finish_reason).toBe("stop");

		const log = await waitForLogByRequestId("tier-fail-open");
		expect(log.gatewayContentFilterEvaluation).toMatchObject({
			violation: false,
			action: "passed",
			moderationFailed: true,
		});
	});

	test("skips moderation when the compliance policy excludes OpenAI", async () => {
		moderation(violent);
		await harness.setOrganizationPlan("enterprise");
		await db
			.update(tables.organization)
			.set({
				providerCompliancePolicy: {
					enabled: true,
					blockedProviders: ["openai"],
				},
			})
			.where(eq(tables.organization.id, "org-id"));
		await harness.setContentFilterSettings({
			providerIds: ["llmgateway"],
			enforce: true,
		});

		const res = await chat("tier-compliance");
		expect((await res.json()).choices[0].finish_reason).toBe("stop");
		expect(moderationCalls).toBe(0);
	});

	test("skips moderation without an OpenAI credential", async () => {
		moderation(violent);
		delete process.env.LLM_OPENAI_API_KEY;
		await harness.setContentFilterSettings({
			providerIds: ["llmgateway"],
			enforce: true,
		});

		const res = await chat("tier-no-credential");
		expect((await res.json()).choices[0].finish_reason).toBe("stop");
		expect(moderationCalls).toBe(0);
	});

	test("shares one moderation call with the env filter", async () => {
		moderation(violent);
		process.env.LLM_CONTENT_FILTER_MODE = "monitor";
		process.env.LLM_CONTENT_FILTER_METHOD = "openai";
		await harness.setContentFilterSettings({
			providerIds: ["llmgateway"],
			enforce: true,
		});

		try {
			const res = await chat("tier-shared-call");
			expect((await res.json()).choices[0].finish_reason).toBe(
				"content_filter",
			);
			expect(moderationCalls).toBe(1);
		} finally {
			delete process.env.LLM_CONTENT_FILTER_METHOD;
		}
	});

	test("images inherit the chat gate and return empty data", async () => {
		moderation(violent);
		await harness.setContentFilterSettings({
			providerIds: ["llmgateway"],
			enforce: true,
		});

		const res = await app.request("/v1/images/generations", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
				"x-request-id": "tier-image",
			},
			body: JSON.stringify({
				model: "llmgateway/custom",
				prompt: "Generate disallowed content",
			}),
		});
		expect(res.status).toBe(200);
		expect((await res.json()).data).toEqual([]);

		const log = await waitForLogByRequestId("tier-image");
		expect(log.finishReason).toBe("llmgateway_content_filter");
	});

	test("the Anthropic endpoint reports a refusal", async () => {
		moderation(violent);
		await harness.setContentFilterSettings({
			providerIds: ["llmgateway"],
			enforce: true,
		});

		const res = await app.request("/v1/messages", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
				"x-request-id": "tier-anthropic",
			},
			body: JSON.stringify({
				model: "llmgateway/custom",
				max_tokens: 64,
				messages: [{ role: "user", content: "Disallowed request" }],
			}),
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.stop_reason).toBe("refusal");
		expect(JSON.stringify(json.content)).toContain(
			"blocked by LLM Gateway's content filter",
		);
	});
});
