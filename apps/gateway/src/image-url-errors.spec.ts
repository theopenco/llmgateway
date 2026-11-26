import { createServer } from "node:net";

import {
	afterAll,
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
import { waitForLogByRequestId } from "@/test-utils/test-helpers.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

describe("unreachable image URL hosts", () => {
	const harness = createGatewayApiTestHarness();
	let resetUrl: string;
	// Accepts the connection, then drops it: undici reports "fetch failed".
	const server = createServer((socket) => socket.destroy());

	beforeAll(async () => {
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("Missing reset server address");
		}
		resetUrl = `http://127.0.0.1:${address.port}/image.png`;
	});

	afterAll(async () => {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
	});

	beforeEach(async () => {
		vi.spyOn(logger, "error");
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("test-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});
		const id = "provider-key-google-ai-studio";
		await db.insert(tables.providerKey).values({
			id,
			...encryptProviderKeyForStorage("test-token", id, "org-id"),
			provider: "google-ai-studio",
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
		});
	});

	afterEach(() => vi.restoreAllMocks());

	test.each([false, true])(
		"returns 400 and logs a client error (stream=%s)",
		async (stream) => {
			const requestId = `image-unreachable-${stream}`;
			const response = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer test-token",
					"x-request-id": requestId,
				},
				body: JSON.stringify({
					model: "google-ai-studio/gemini-3.1-flash-lite",
					stream,
					messages: [
						{
							role: "user",
							content: [{ type: "image_url", image_url: { url: resetUrl } }],
						},
					],
				}),
			});

			expect(response.status).toBe(400);
			expect(await response.json()).toMatchObject({
				error: {
					type: "invalid_request_error",
					message: expect.stringContaining(
						"could not connect to the image host",
					),
				},
			});

			const log = await waitForLogByRequestId(requestId);
			expect(log.finishReason).toBe("client_error");
			expect(log.hasError).toBe(true);
			expect(log.errorDetails?.statusCode).toBe(400);
			expect(log.errorDetails?.responseText).toContain(
				"could not connect to the image host",
			);
			expect(logger.error).not.toHaveBeenCalled();
		},
	);
});
