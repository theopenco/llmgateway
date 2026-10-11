import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import { waitForLogByRequestId } from "./test-utils/test-helpers.js";

import type * as UrlSafety from "@llmgateway/shared/url-safety-node";

const imageUrl = "https://example.cos.ap-guangzhou.myqcloud.com/main.png";
const imageBase64 = Buffer.from("png-bytes").toString("base64");

// The returned URL is a fake host, so skip its DNS-based safety check.
vi.mock("@llmgateway/shared/url-safety-node", async (importOriginal) => ({
	...(await importOriginal<typeof UrlSafety>()),
	assertSafeUserContentUrl: vi.fn(async () => undefined),
}));

describe("tencent hy image generation", () => {
	const harness = createGatewayApiTestHarness();
	const upstream: Array<{ path: string; body: Record<string, unknown> }> = [];
	let respond: () => Response;

	beforeEach(async () => {
		upstream.length = 0;
		respond = () =>
			Response.json({
				object: "image.chat.completion.chunk",
				choices: [
					{
						index: 0,
						delta: { type: "image", image: { url: imageUrl } },
						finish_reason: null,
					},
				],
				usage: { total_tokens: 20000 },
				tokenhub_usage: { total_tokens: 20000 },
			});
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("test-token"),
			projectId: "project-id",
			createdBy: "user-id",
			description: "Test API Key",
		});
		const id = "provider-key-tencent";
		await db.insert(tables.providerKey).values({
			id,
			...encryptProviderKeyForStorage("test-token", id, "org-id"),
			provider: "tencent",
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
		});

		const originalFetch = globalThis.fetch;
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			const url = new URL(
				typeof input === "string" || input instanceof URL ? input : input.url,
			);
			if (url.href === imageUrl) {
				return new Response(Buffer.from("png-bytes"), {
					headers: { "Content-Type": "image/png" },
				});
			}
			if (!url.href.startsWith(harness.mockServerUrl)) {
				return await originalFetch(input, init);
			}
			upstream.push({
				path: url.pathname,
				body: JSON.parse(String(init?.body)) as Record<string, unknown>,
			});
			return respond();
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	async function generate() {
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
				model: "tencent/hy-image-v3.5-preview",
				messages: [{ role: "user", content: "A red bicycle" }],
				image_config: { image_size: "4096x2304" },
			}),
		});
		return { res, requestId };
	}

	test("calls the Hy Image endpoint and bills the reported tokens", async () => {
		const { res, requestId } = await generate();
		const json = await res.json();

		expect(res.status, JSON.stringify(json)).toBe(200);
		expect(json.object).toBe("chat.completion");
		expect(json.choices[0].finish_reason).toBe("stop");
		expect(json.choices[0].message.images).toEqual([
			{
				type: "image_url",
				image_url: { url: `data:image/png;base64,${imageBase64}` },
			},
		]);
		expect(json.usage.cost).toBeCloseTo(0.032, 10);
		expect(upstream).toEqual([
			{
				path: "/v1/wand/hunyuan-image/v35-generation",
				body: {
					model: "hy-image-v3.5-preview",
					messages: [
						{
							role: "user",
							content: [{ type: "text", text: "A red bicycle" }],
						},
					],
					size: "4096x2304",
				},
			},
		]);

		const log = await waitForLogByRequestId(requestId);
		expect(log.hasError).toBe(false);
		expect(Number(log.completionTokens)).toBe(20000);
		expect(Number(log.cost)).toBeCloseTo(0.032, 10);
	});

	test("accepts an SSE body", async () => {
		const frame = await respond().text();
		respond = () =>
			new Response(`data: ${frame}\n\n`, {
				headers: { "Content-Type": "text/event-stream" },
			});

		const { res } = await generate();
		const json = await res.json();

		expect(res.status, JSON.stringify(json)).toBe(200);
		expect(json.choices[0].message.images).toEqual([
			{
				type: "image_url",
				image_url: { url: `data:image/png;base64,${imageBase64}` },
			},
		]);
	});

	test("maps a moderation failure to content_filter", async () => {
		respond = () =>
			Response.json({
				object: "image.chat.completion.chunk",
				choices: [{ index: 0, delta: {}, finish_reason: "error" }],
				error: {
					type: "invalid_request_error",
					code: "content_filter",
					message: "input moderation rejected",
				},
			});

		const { res } = await generate();
		const json = await res.json();

		expect(res.status, JSON.stringify(json)).toBe(200);
		expect(json.choices[0].finish_reason).toBe("content_filter");
		expect(json.choices[0].message.images).toBeUndefined();
	});

	test("serves /v1/images/generations", async () => {
		const res = await app.request("/v1/images/generations", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer test-token",
				"x-no-fallback": "true",
			},
			body: JSON.stringify({
				model: "tencent/hy-image-v3.5-preview",
				prompt: "A red bicycle",
				size: "2048x2048",
			}),
		});
		const json = await res.json();

		expect(res.status, JSON.stringify(json)).toBe(200);
		expect(json.data).toEqual([
			expect.objectContaining({ b64_json: imageBase64 }),
		]);
		expect(upstream[0]?.body.size).toBe("2048x2048");
	});
});
