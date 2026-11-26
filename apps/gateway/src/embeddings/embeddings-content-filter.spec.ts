import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";
import { waitForLogByRequestId } from "@/test-utils/test-helpers.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";
import { GATEWAY_CONTENT_FILTER_MESSAGE } from "@llmgateway/shared";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

const MODERATION_URL = "https://api.openai.com/v1/moderations";

function embeddingsContentFilterTests() {
	const harness = createGatewayApiTestHarness();
	let previousOpenAIKey: string | undefined;
	let previousContentFilterMode: string | undefined;
	let moderationCalls = 0;
	let embeddingCalls = 0;
	let moderationBodies: string[] = [];

	beforeEach(async () => {
		previousOpenAIKey = process.env.LLM_OPENAI_API_KEY;
		previousContentFilterMode = process.env.LLM_CONTENT_FILTER_MODE;
		process.env.LLM_OPENAI_API_KEY = ["sk", "openai", "test"].join("-");
		delete process.env.LLM_CONTENT_FILTER_MODE;
		moderationCalls = 0;
		embeddingCalls = 0;
		moderationBodies = [];

		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});
		await db.insert(tables.providerKey).values({
			id: "provider-key-openai",
			...encryptProviderKeyForStorage(
				"openai-test-key",
				"provider-key-openai",
				"org-id",
			),
			provider: "openai",
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
		});

		const originalFetch = globalThis.fetch;
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			const url =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.toString()
						: input.url;
			if (url === MODERATION_URL) {
				moderationCalls += 1;
				moderationBodies.push(String(init?.body ?? ""));
				return Response.json({
					id: "modr-embeddings",
					model: "omni-moderation-latest",
					results: [
						{ flagged: true, category_scores: { violence: 0.95, hate: 0.1 } },
					],
				});
			}
			if (url.endsWith("/v1/embeddings")) {
				embeddingCalls += 1;
			}
			return await originalFetch(input, init);
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
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

	const embed = (requestId: string, input: string | string[] | number[]) =>
		app.request("/v1/embeddings", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
				"x-request-id": requestId,
			},
			body: JSON.stringify({ model: "text-embedding-3-small", input }),
		});

	test("skips moderation when the provider is not enabled", async () => {
		await harness.setContentFilterSettings({
			providerIds: ["google-vertex"],
			moderateEmbeddings: true,
		});

		const res = await embed("embed-tier-provider-off", "Embed this text");
		expect(res.status).toBe(200);
		expect(moderationCalls).toBe(0);

		const log = await waitForLogByRequestId("embed-tier-provider-off");
		expect(log.finishReason).toBe("stop");
		expect(log.gatewayContentFilterEvaluation).toBeNull();
	});

	test("skips moderation while embeddings moderation is off", async () => {
		await harness.setContentFilterSettings({
			providerIds: ["openai"],
			enforce: true,
		});

		const res = await embed("embed-tier-setting-off", "Embed this text");
		expect(res.status).toBe(200);
		expect(moderationCalls).toBe(0);
		expect(embeddingCalls).toBe(1);

		const log = await waitForLogByRequestId("embed-tier-setting-off");
		expect(log.gatewayContentFilterEvaluation).toBeNull();
	});

	test("attaches a log-only evaluation to the log", async () => {
		await harness.setContentFilterSettings({
			providerIds: ["openai"],
			moderateEmbeddings: true,
		});

		const res = await embed("embed-tier-log-only", [
			"First passage to embed",
			"Second passage to embed",
		]);
		expect(res.status).toBe(200);
		expect((await res.json()).data).toHaveLength(2);

		const log = await waitForLogByRequestId("embed-tier-log-only");
		expect(moderationCalls).toBe(1);
		expect(moderationBodies[0]).toContain("First passage to embed");
		expect(moderationBodies[0]).toContain("Second passage to embed");
		expect(log.finishReason).toBe("stop");
		expect(log.internalContentFilter).toBe(true);
		expect(log.gatewayContentFilterEvaluation).toMatchObject({
			sampled: true,
			classifier: "openai",
			provider: "openai",
			violation: true,
			action: "logged",
			enforced: false,
			exemptReason: "global_log_only",
			matchedCategories: ["violence"],
		});
		expect(log.gatewayContentFilterResponse).toHaveLength(1);
	});

	test("skips moderation for token-ID input", async () => {
		await harness.setContentFilterSettings({
			providerIds: ["openai"],
			enforce: true,
			moderateEmbeddings: true,
		});

		const res = await embed("embed-tier-token-ids", [1, 2, 3]);
		expect(res.status).toBe(200);
		expect(moderationCalls).toBe(0);

		const log = await waitForLogByRequestId("embed-tier-token-ids");
		expect(log.gatewayContentFilterEvaluation).toBeNull();
	});

	test("blocks a violation when enforcement is on", async () => {
		await harness.setContentFilterSettings({
			providerIds: ["openai"],
			enforce: true,
			moderateEmbeddings: true,
		});

		const res = await embed("embed-tier-block", "Embed this text");
		expect(res.status).toBe(403);
		expect((await res.json()).error.message).toBe(
			GATEWAY_CONTENT_FILTER_MESSAGE,
		);
		expect(moderationCalls).toBe(1);
		expect(embeddingCalls).toBe(0);

		const log = await waitForLogByRequestId("embed-tier-block");
		expect(log.finishReason).toBe("llmgateway_content_filter");
		expect(log.unifiedFinishReason).toBe("content_filter");
		expect(log.internalContentFilter).toBe(true);
		expect(log.hasError).toBe(false);
		expect(Number(log.cost)).toBe(0);
		expect(log.gatewayContentFilterEvaluation).toMatchObject({
			violation: true,
			action: "blocked",
			enforced: true,
		});
	});
}

describe("embeddings gateway content filter", embeddingsContentFilterTests);
