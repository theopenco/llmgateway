import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";

const IMAGE_URL = "https://example.com/image-edit-upload.png";

describe("OpenAI image-edit upload bounds", () => {
	const harness = createGatewayApiTestHarness();

	beforeEach(async () => {
		await db.insert(tables.apiKey).values({
			id: "image-edit-bounds-token",
			...hashApiKeyForStorage("image-edit-bounds-test-token"),
			projectId: "project-id",
			description: "Image edit bounds test key",
			createdBy: "user-id",
		});
		await db.insert(tables.providerKey).values({
			id: "image-edit-bounds-provider",
			...encryptProviderKeyForStorage(
				"image-edit-bounds-provider-key",
				"image-edit-bounds-provider",
				"org-id",
			),
			provider: "openai",
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	it("bounds OpenAI image-edit uploads even without a Content-Length header", async () => {
		// Every plan resolves to a 1MB image limit, whatever plan the org is on.
		vi.stubEnv("IMAGE_SIZE_LIMIT_FREE_MB", "1");
		vi.stubEnv("IMAGE_SIZE_LIMIT_PRO_MB", "1");
		vi.stubEnv("IMAGE_SIZE_LIMIT_ENTERPRISE_MB", "1");
		const originalFetch = globalThis.fetch;
		const canceled = vi.fn();
		const upstream = vi.fn();
		vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
			if (String(url) === IMAGE_URL) {
				// Endless body with no Content-Length: only a bounded read stops it.
				return new Response(
					new ReadableStream({
						pull(controller) {
							controller.enqueue(new Uint8Array(1024 * 1024));
						},
						cancel: canceled,
					}),
					{ headers: { "content-type": "image/png" } },
				);
			}
			if (String(url).startsWith(harness.mockServerUrl)) {
				upstream();
			}
			return await originalFetch(url, options);
		});
		const response = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer image-edit-bounds-test-token",
				"x-no-fallback": "true",
			},
			body: JSON.stringify({
				model: "openai/gpt-image-2",
				messages: [
					{
						role: "user",
						content: [
							{ type: "text", text: "edit this image" },
							{ type: "image_url", image_url: { url: IMAGE_URL } },
						],
					},
				],
			}),
		});
		expect(response.status).toBe(400);
		expect(await response.text()).toContain("exceeds the 1MB limit");
		expect(canceled).toHaveBeenCalled();
		expect(upstream).not.toHaveBeenCalled();
	}, 15_000);
});
