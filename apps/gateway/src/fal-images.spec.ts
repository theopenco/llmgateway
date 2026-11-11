import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import { waitForLogByRequestId } from "./test-utils/test-helpers.js";

import type * as UrlSafety from "@llmgateway/shared/url-safety-node";

const imageUrl = "https://v3b.fal.media/files/b/test/image.png";
const imageBase64 = Buffer.from("png-bytes").toString("base64");

// The returned URL is a fake file, so skip its DNS-based safety check.
vi.mock("@llmgateway/shared/url-safety-node", async (importOriginal) => ({
	...(await importOriginal<typeof UrlSafety>()),
	assertSafeUserContentUrl: vi.fn(async () => undefined),
}));

describe("fal image generation", () => {
	const harness = createGatewayApiTestHarness();
	const upstream: Array<{ path: string; body: Record<string, unknown> }> = [];
	let respond: () => Response;

	beforeEach(async () => {
		upstream.length = 0;
		respond = () =>
			Response.json({
				images: [
					{
						url: imageUrl,
						content_type: "image/png",
						width: 1536,
						height: 1024,
					},
				],
				has_nsfw_concepts: [false],
				seed: 1,
			});
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("test-token"),
			projectId: "project-id",
			createdBy: "user-id",
			description: "Test API Key",
		});
		const id = "provider-key-fal";
		await db.insert(tables.providerKey).values({
			id,
			...encryptProviderKeyForStorage("test-token", id, "org-id"),
			provider: "fal-ai",
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

	async function generate(imageSize = "1536x1024") {
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
				model: "fal-ai/flux-2-klein-4b",
				messages: [{ role: "user", content: "A red bicycle" }],
				image_config: { image_size: imageSize },
			}),
		});
		return { res, requestId };
	}

	test("calls fal synchronously and bills the size tier", async () => {
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
		expect(json.usage.cost).toBeCloseTo(0.0075, 10);
		expect(upstream).toEqual([
			{
				path: "/fal-ai/flux-2/klein/4b",
				body: {
					prompt: "A red bicycle",
					image_size: { width: 1536, height: 1024 },
				},
			},
		]);

		const log = await waitForLogByRequestId(requestId);
		expect(log.hasError).toBe(false);
		expect(Number(log.cost)).toBeCloseTo(0.0075, 10);
	});

	test("maps a safety-checker hit to content_filter", async () => {
		respond = () =>
			Response.json({
				images: [{ url: imageUrl, content_type: "image/png" }],
				has_nsfw_concepts: [true],
			});

		const { res } = await generate();
		const json = await res.json();

		expect(res.status, JSON.stringify(json)).toBe(200);
		expect(json.choices[0].finish_reason).toBe("content_filter");
		expect(json.choices[0].message.images).toBeUndefined();
	});

	test("rejects a size without a catalogue price", async () => {
		const { res } = await generate("4096x4096");

		expect(res.status).toBe(400);
		expect(upstream).toEqual([]);
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
				model: "fal-ai/recraft-v4.1-flash",
				prompt: "A red bicycle",
				size: "1024x1024",
				n: 2,
			}),
		});
		const json = await res.json();

		expect(res.status, JSON.stringify(json)).toBe(200);
		expect(json.data).toEqual([
			expect.objectContaining({ b64_json: imageBase64 }),
		]);
		expect(upstream).toEqual([
			{
				path: "/recraft/v4.1/flash/text-to-image",
				body: {
					prompt: expect.stringContaining("A red bicycle"),
					image_size: { width: 1024, height: 1024 },
				},
			},
		]);
	});
});
