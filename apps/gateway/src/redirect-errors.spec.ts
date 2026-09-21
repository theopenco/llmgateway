import { createServer } from "node:http";

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
import { db, eq, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

describe("blocked redirects", () => {
	const harness = createGatewayApiTestHarness();
	let redirectUrl: string;
	let redirectRequests = 0;
	let followedRedirects = 0;
	const server = createServer((req, res) => {
		if (req.url === "/target") {
			followedRedirects++;
			res.writeHead(200).end();
			return;
		}
		redirectRequests++;
		res.writeHead(307, { Location: "/target" }).end();
	});

	beforeAll(async () => {
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("Missing redirect server address");
		}
		redirectUrl = `http://127.0.0.1:${address.port}`;
	});

	afterAll(async () => {
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
	});

	beforeEach(async () => {
		redirectRequests = 0;
		followedRedirects = 0;
		vi.spyOn(logger, "error");
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("test-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});
	});

	afterEach(() => vi.restoreAllMocks());

	async function seedProvider(provider: string, baseUrl: string) {
		const id = `provider-key-${provider}`;
		await db.insert(tables.providerKey).values({
			id,
			...encryptProviderKeyForStorage("test-token", id, "org-id"),
			provider,
			organizationId: "org-id",
			baseUrl,
		});
	}

	async function expectClientError(requestId: string) {
		const log = await waitForLogByRequestId(requestId);
		expect(log.finishReason).toBe("client_error");
		expect(log.unifiedFinishReason).toBe("client_error");
		expect(log.hasError).toBe(true);
		expect(log.errorDetails?.statusCode).toBe(400);
		expect(log.errorDetails?.responseText).toContain(
			"redirects are not allowed",
		);
		expect(log.retried).toBeFalsy();
		expect(
			await db.query.log.findMany({
				where: { requestId: { eq: requestId } },
			}),
		).toHaveLength(1);
		expect(redirectRequests).toBe(1);
		expect(followedRedirects).toBe(0);
		expect(logger.error).not.toHaveBeenCalled();
		return log;
	}

	test.each([false, true])(
		"image input returns 400 before streaming starts (stream=%s)",
		async (stream) => {
			await seedProvider("google-ai-studio", harness.mockServerUrl);
			const requestId = `image-redirect-${stream}`;
			const response = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer test-token",
					"x-request-id": requestId,
				},
				body: JSON.stringify({
					model: "google-ai-studio/gemini-2.5-flash",
					stream,
					messages: [
						{
							role: "user",
							content: [{ type: "image_url", image_url: { url: redirectUrl } }],
						},
					],
				}),
			});
			expect(response.status).toBe(400);
			expect(await response.json()).toMatchObject({
				error: {
					type: "invalid_request_error",
					message: expect.stringContaining("Use the final URL directly"),
				},
			});
			await expectClientError(requestId);
		},
	);

	test.each([
		{
			path: "/v1/chat/completions",
			body: {
				model: "openai/gpt-4o-mini",
				messages: [{ role: "user", content: "hi" }],
			},
		},
		{
			path: "/v1/embeddings",
			body: { model: "openai/text-embedding-3-small", input: "hi" },
		},
		{
			path: "/v1/moderations",
			body: { model: "openai/omni-moderation-latest", input: "hi" },
		},
		{
			path: "/v1/audio/speech",
			body: { model: "openai/tts-1", input: "hi", voice: "alloy" },
		},
		{
			path: "/v1/videos",
			body: {
				model: "bytedance/seedance-2-0",
				prompt: "A bird flying",
				size: "1280x720",
				seconds: 5,
			},
		},
	])(
		"$path records provider redirects as client errors",
		async ({ path, body }) => {
			await seedProvider(body.model.split("/")[0], redirectUrl);
			const requestId = `provider-redirect-${path.split("/").at(-1)}`;
			const response = await app.request(path, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer test-token",
					"x-request-id": requestId,
				},
				body: JSON.stringify(body),
			});
			expect(response.status).toBe(400);
			expect(await response.text()).toContain("redirects are not allowed");
			await expectClientError(requestId);
		},
	);

	test("audio download redirects return 400 and log a client error", async () => {
		await seedProvider("alibaba", harness.mockServerUrl);
		const nativeFetch = globalThis.fetch;
		vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
			if (String(input).startsWith(harness.mockServerUrl)) {
				return Promise.resolve(
					Response.json({ output: { audio: { url: redirectUrl } } }),
				);
			}
			return nativeFetch(input, init);
		});
		const requestId = "audio-download-redirect";
		const response = await app.request("/v1/audio/speech", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer test-token",
				"x-request-id": requestId,
			},
			body: JSON.stringify({
				model: "alibaba/qwen-audio-3.0-tts-plus",
				input: "hi",
				voice: "longanlingxin",
			}),
		});
		expect(response.status).toBe(400);
		expect(await response.text()).toContain("redirects are not allowed");
		await expectClientError(requestId);
	});

	test("provider redirects emit a client error on an open stream and respect retention", async () => {
		await seedProvider("openai", redirectUrl);
		await db
			.update(tables.organization)
			.set({ retentionLevel: "none" })
			.where(eq(tables.organization.id, "org-id"));
		const requestId = "stream-redirect";
		const response = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer test-token",
				"x-request-id": requestId,
			},
			body: JSON.stringify({
				model: "openai/gpt-4o-mini",
				stream: true,
				messages: [{ role: "user", content: "hi" }],
			}),
		});
		const body = await response.text();
		expect(body).toContain("invalid_request_error");
		expect(body).toContain("redirects are not allowed");
		const log = await expectClientError(requestId);
		expect(log.messages).toBeNull();
		expect(log.content).toBeNull();
	});
});
