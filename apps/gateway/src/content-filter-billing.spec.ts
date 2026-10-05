import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import { waitForLogByRequestId } from "./test-utils/test-helpers.js";

describe("provider safety block billing", () => {
	const harness = createGatewayApiTestHarness();
	let upstream: () => Response = () => Response.json({});

	beforeEach(async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("test-token"),
			projectId: "project-id",
			createdBy: "user-id",
			description: "Test API Key",
		});
		for (const provider of ["openai", "google-ai-studio", "xai"]) {
			const id = `provider-key-${provider}`;
			await db.insert(tables.providerKey).values({
				id,
				...encryptProviderKeyForStorage("test-token", id, "org-id"),
				provider,
				organizationId: "org-id",
				baseUrl: harness.mockServerUrl,
			});
		}

		const originalFetch = globalThis.fetch;
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			const url = new URL(
				typeof input === "string" || input instanceof URL ? input : input.url,
			);
			if (!url.href.startsWith(harness.mockServerUrl)) {
				return await originalFetch(input, init);
			}
			return upstream();
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	const generateImage = (model: string, requestId: string) =>
		app.request("/v1/images/generations", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer test-token",
				"x-request-id": requestId,
				"x-no-fallback": "true",
			},
			body: JSON.stringify({ model, prompt: "A blue circle" }),
		});

	test("Gemini image safety block bills the reported input only", async () => {
		upstream = () =>
			Response.json({
				candidates: [{ finishReason: "IMAGE_SAFETY", index: 0 }],
				usageMetadata: {
					promptTokenCount: 12,
					candidatesTokenCount: 1,
					totalTokenCount: 13,
				},
			});
		const requestId = randomUUID();
		const res = await generateImage(
			"google-ai-studio/gemini-3-pro-image",
			requestId,
		);
		const json = await res.json();
		expect(res.status, JSON.stringify(json)).toBe(200);
		expect(json.data).toHaveLength(0);

		const log = await waitForLogByRequestId(requestId);
		expect(log.unifiedFinishReason).toBe("content_filter");
		expect(log.hasError).toBe(false);
		// Google serves the block as a 200 with usage and charges the input, so
		// the prompt tokens it reported are billed and the blocked image is not.
		expect(Number(log.promptTokens)).toBe(12);
		expect(Number(log.inputCost)).toBeCloseTo(12 * 2e-6, 9);
		expect(Number(log.imageOutputCost ?? 0)).toBe(0);
		expect(Number(log.contentFilterCost ?? 0)).toBe(0);
		expect(Number(log.cost)).toBeCloseTo(
			Number(log.inputCost) + Number(log.outputCost),
			9,
		);
	});

	test("OpenAI moderation rejection is a free content filter", async () => {
		upstream = () =>
			Response.json(
				{
					error: {
						code: "moderation_blocked",
						message:
							"Your request was rejected by the safety system. Your prompt may contain text that is not allowed by our safety system.",
						type: "image_generation_user_error",
					},
				},
				{ status: 400 },
			);
		const requestId = randomUUID();
		const res = await generateImage("openai/gpt-image-2", requestId);
		const json = await res.json();
		expect(res.status, JSON.stringify(json)).toBe(200);
		expect(json.data).toHaveLength(0);

		const log = await waitForLogByRequestId(requestId);
		expect(log.unifiedFinishReason).toBe("content_filter");
		expect(log.hasError).toBe(false);
		expect(Number(log.cost)).toBe(0);
		expect(Number(log.promptTokens)).toBeGreaterThan(0);
	});

	test("xAI image rejection is a free content filter", async () => {
		// xAI's $0.05 usage-guideline fee is published for the Responses API
		// only; the Imagine API documents no rejection fee.
		upstream = () =>
			Response.json({ error: "imagine:content-moderated" }, { status: 400 });
		const requestId = randomUUID();
		const res = await generateImage("xai/grok-imagine-image", requestId);
		const json = await res.json();
		expect(res.status, JSON.stringify(json)).toBe(200);
		expect(json.data).toHaveLength(0);

		const log = await waitForLogByRequestId(requestId);
		expect(log.unifiedFinishReason).toBe("content_filter");
		expect(Number(log.inputCost)).toBe(0);
		expect(Number(log.contentFilterCost ?? 0)).toBe(0);
		expect(Number(log.cost)).toBe(0);
	});

	test("xAI chat rejection bills only the declared rejection fee", async () => {
		upstream = () =>
			Response.json(
				{ error: "Content violates usage guidelines" },
				{ status: 403 },
			);
		const requestId = randomUUID();
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer test-token",
				"x-request-id": requestId,
				"x-no-fallback": "true",
			},
			body: JSON.stringify({
				model: "xai/grok-4",
				messages: [{ role: "user", content: "Hello" }],
			}),
		});
		const json = await res.json();
		expect(res.status, JSON.stringify(json)).toBe(200);
		expect(json.choices[0].finish_reason).toBe("content_filter");

		const log = await waitForLogByRequestId(requestId);
		expect(log.unifiedFinishReason).toBe("content_filter");
		expect(Number(log.inputCost)).toBe(0);
		expect(Number(log.contentFilterCost)).toBeCloseTo(0.05);
		expect(Number(log.cost)).toBeCloseTo(0.05);
	});
});
