import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { db, tables } from "@llmgateway/db";
import { models } from "@llmgateway/models";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import { waitForLogByRequestId } from "./test-utils/test-helpers.js";

import type { ProviderModelMapping } from "@llmgateway/models";

async function readSseText(
	stream: ReadableStream<Uint8Array> | null,
): Promise<string> {
	if (!stream) {
		return "";
	}
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let text = "";
	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		text += decoder.decode(value, { stream: true });
	}
	return text;
}

// Any active stealth provider with an OpenAI-compatible chat endpoint works
// here; the leaky mock below speaks that shape. Routing skips deactivated
// mappings, so if this one is ever retired swap in another active stealth
// mapping instead of dropping the coverage.
const STEALTH_PROVIDER = "tundra";
const STEALTH_MODEL_ID = "kimi-k2.6";
const STEALTH_MODEL = `${STEALTH_PROVIDER}/${STEALTH_MODEL_ID}`;

// The secret markers a stealth provider's raw error could leak: the vendor
// name inside the error body and the host of the secret base URL.
const SECRET_VENDOR = "SecretVendor";
const LEAKY_ERROR_BODY = JSON.stringify({
	error: {
		message: `${SECRET_VENDOR} API error: quota exceeded on api.secretvendor.com`,
		type: "insufficient_quota",
		code: `${SECRET_VENDOR}_insufficient_quota`,
	},
});

// A half-written, unparseable SSE chunk that still carries the vendor identity.
const TRUNCATED_LEAKY_MARKER = `${SECRET_VENDOR} internal note: api.secretvendor.com`;
const TRUNCATED_LEAKY_CHUNK = `data: {"choices":[{"delta":{"content":"${TRUNCATED_LEAKY_MARKER}`;

describe("stealth provider error redaction (routes)", () => {
	const harness = createGatewayApiTestHarness();

	let leakyServer: Server;
	let leakyServerUrl = "";
	const savedEnv: Record<string, string | undefined> = {};

	beforeAll(async () => {
		leakyServer = createServer((req, res) => {
			let body = "";
			req.on("data", (chunk) => (body += chunk));
			req.on("end", () => {
				const isStream = body.includes('"stream":true');
				// "http500" prompts force a plain HTTP error even for streams;
				// "midstream" prompts get a valid delta chunk before the error;
				// "readfault" prompts kill the socket after a half-written event so
				// the gateway fails inside reader.read() with the leaky bytes still
				// sitting in its SSE buffer.
				if (isStream && !body.includes("http500")) {
					res.writeHead(200, { "content-type": "text/event-stream" });
					if (body.includes("midstream") || body.includes("readfault")) {
						res.write(
							`data: ${JSON.stringify({
								id: "cmpl-1",
								object: "chat.completion.chunk",
								created: 1,
								model: STEALTH_MODEL_ID,
								choices: [
									{
										index: 0,
										delta: { role: "assistant", content: "hi" },
										finish_reason: null,
									},
								],
							})}\n\n`,
						);
					}
					if (body.includes("readfault")) {
						// Truncated mid-JSON and never terminated, so the gateway can
						// neither parse it as an event nor as an in-band error: the raw
						// vendor-branded bytes are still sitting in its SSE buffer when
						// the socket dies, which is what lands in bufferSnapshot.
						res.write(TRUNCATED_LEAKY_CHUNK, () => {
							res.socket?.destroy();
						});
						return;
					}
					res.write(`data: ${LEAKY_ERROR_BODY}\n\n`);
					res.end();
					return;
				}
				res.writeHead(500, { "content-type": "application/json" });
				res.end(LEAKY_ERROR_BODY);
			});
		});
		await new Promise<void>((resolve) => {
			leakyServer.listen(0, "127.0.0.1", resolve);
		});
		const address = leakyServer.address();
		if (!address || typeof address === "string") {
			throw new Error("Failed to bind leaky mock server");
		}
		leakyServerUrl = `http://127.0.0.1:${address.port}`;

		for (const key of [
			"LLM_TUNDRA_API_KEY",
			"LLM_TUNDRA_BASE_URL",
			"LLM_GLACIER_API_KEY",
			"LLM_GLACIER_BASE_URL",
			"LLM_OPENAI_API_KEY",
			"LLM_OPENAI_BASE_URL",
			"LLM_AVALANCHE_API_KEY",
			"LLM_AVALANCHE_BASE_URL",
		]) {
			savedEnv[key] = process.env[key];
		}
		process.env.LLM_TUNDRA_API_KEY = "tundra-env-key";
		process.env.LLM_TUNDRA_BASE_URL = leakyServerUrl;
		process.env.LLM_GLACIER_API_KEY = "glacier-env-key";
		process.env.LLM_GLACIER_BASE_URL = leakyServerUrl;
		// openai is the non-stealth control: same leaky mock, no redaction.
		process.env.LLM_OPENAI_API_KEY = "openai-env-key";
		process.env.LLM_OPENAI_BASE_URL = leakyServerUrl;
		process.env.LLM_AVALANCHE_API_KEY = "avalanche-env-key";
		process.env.LLM_AVALANCHE_BASE_URL = leakyServerUrl;
	});

	afterAll(async () => {
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value !== undefined) {
				process.env[key] = value;
			} else {
				Reflect.deleteProperty(process.env, key);
			}
		}
		await new Promise<void>((resolve, reject) => {
			leakyServer.close((err) => (err ? reject(err) : resolve()));
		});
	});

	async function setupCreditsApiKey(token: string) {
		await harness.setProjectMode("credits");
		await harness.setOrganizationCredits("100");
		await db.insert(tables.apiKey).values({
			id: `${token}-id`,
			...hashApiKeyForStorage(token),
			projectId: "project-id",
			description: "Stealth redaction test key",
			createdBy: "user-id",
		});
	}

	function expectNoLeak(payload: string) {
		expect(payload).not.toContain(SECRET_VENDOR);
		expect(payload).not.toContain("secretvendor.com");
		expect(payload).not.toContain(leakyServerUrl);
		expect(payload).not.toContain("insufficient_quota");
	}

	test("the pinned stealth mapping is still routable", () => {
		const mapping: ProviderModelMapping | undefined = models
			.find((model) => model.id === STEALTH_MODEL_ID)
			?.providers.find((provider) => provider.providerId === STEALTH_PROVIDER);
		if (!mapping) {
			throw new Error(`${STEALTH_MODEL} is missing from the model catalogue`);
		}
		expect(
			Boolean(mapping.deactivatedAt && mapping.deactivatedAt <= new Date()),
		).toBe(false);
	});

	async function expectRedactedLog(requestId: string) {
		const log = await waitForLogByRequestId(requestId);
		expect(log.hasError).toBe(true);
		expect(log.errorDetails).toBeTruthy();
		expectNoLeak(JSON.stringify(log.errorDetails));
		expect(log.internalErrorDetails).toBeTruthy();
		expect(JSON.stringify(log.internalErrorDetails)).toContain(SECRET_VENDOR);
		return log;
	}

	test("/v1/videos hides the raw upstream error for a stealth provider", async () => {
		await setupCreditsApiKey("stealth-video-token");
		const res = await app.request("/v1/videos", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer stealth-video-token",
				"x-no-fallback": "true",
			},
			body: JSON.stringify({
				model: "avalanche/veo-3.1-generate-preview",
				prompt: "A mountain range at sunrise",
				size: "1920x1080",
				seconds: 8,
			}),
		});

		expect(res.status).toBe(500);
		const text = await res.text();
		expectNoLeak(text);
		expect(JSON.parse(text).error.message).toBe(
			"Upstream provider error (500 Internal Server Error)",
		);
	});

	test("/v1/chat/completions non-streaming hides the raw upstream error", async () => {
		await setupCreditsApiKey("stealth-token-nonstream");

		const requestId = "stealth-nonstream-request";
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer stealth-token-nonstream",
				"x-no-fallback": "true",
				"x-request-id": requestId,
			},
			body: JSON.stringify({
				model: STEALTH_MODEL,
				messages: [{ role: "user", content: "nonstream leak check" }],
			}),
		});

		expect(res.status).toBe(500);
		const text = await res.text();
		expectNoLeak(text);
		const json = JSON.parse(text);
		expect(json.error.message).toBe(
			`Error from provider ${STEALTH_PROVIDER}: 500 Internal Server Error`,
		);
		expect(json.error.responseText).toBe(
			"Upstream provider error (500 Internal Server Error)",
		);

		await expectRedactedLog(requestId);
	});

	test("/v1/chat/completions streaming HTTP error hides the raw upstream error", async () => {
		await setupCreditsApiKey("stealth-token-stream-http");

		const requestId = "stealth-stream-http-request";
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer stealth-token-stream-http",
				"x-no-fallback": "true",
				"x-request-id": requestId,
			},
			body: JSON.stringify({
				model: STEALTH_MODEL,
				stream: true,
				messages: [{ role: "user", content: "stream http500 leak check" }],
			}),
		});

		const text = await readSseText(res.body);
		expectNoLeak(text);
		expect(text).toContain(
			`Error from provider ${STEALTH_PROVIDER}: 500 Internal Server Error`,
		);

		await expectRedactedLog(requestId);
	});

	test("/v1/chat/completions immediate streaming error event hides the raw upstream error", async () => {
		await setupCreditsApiKey("stealth-token-stream-immediate");

		const requestId = "stealth-stream-immediate-request";
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer stealth-token-stream-immediate",
				"x-no-fallback": "true",
				"x-request-id": requestId,
			},
			body: JSON.stringify({
				model: STEALTH_MODEL,
				stream: true,
				messages: [{ role: "user", content: "immediate error leak check" }],
			}),
		});

		const text = await readSseText(res.body);
		expectNoLeak(text);
		expect(text).toContain("event: error");
		expect(text).toContain("Upstream provider error (");

		await expectRedactedLog(requestId);
	});

	test("/v1/chat/completions mid-stream error event hides the raw upstream error", async () => {
		await setupCreditsApiKey("stealth-token-stream-mid");

		const requestId = "stealth-stream-mid-request";
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer stealth-token-stream-mid",
				"x-no-fallback": "true",
				"x-request-id": requestId,
			},
			body: JSON.stringify({
				model: STEALTH_MODEL,
				stream: true,
				messages: [{ role: "user", content: "midstream error leak check" }],
			}),
		});

		const text = await readSseText(res.body);
		expectNoLeak(text);
		expect(text).toContain("event: error");

		await expectRedactedLog(requestId);
	});

	test("/v1/chat/completions mid-stream read fault hides the buffered upstream body", async () => {
		await setupCreditsApiKey("stealth-token-stream-readfault");

		const requestId = "stealth-stream-readfault-request";
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer stealth-token-stream-readfault",
				"x-no-fallback": "true",
				"x-request-id": requestId,
			},
			body: JSON.stringify({
				model: STEALTH_MODEL,
				stream: true,
				messages: [{ role: "user", content: "readfault leak check" }],
			}),
		});

		const text = await readSseText(res.body);
		// The buffered upstream body is the leak vector here: it is emitted as the
		// error event's responseText, so the vendor-branded partial event must not
		// survive into the client SSE.
		expectNoLeak(text);
		expect(text).toContain("event: error");
		expect(text).toContain("Upstream provider error (");

		const log = await waitForLogByRequestId(requestId);
		expect(log.hasError).toBe(true);
		expectNoLeak(JSON.stringify(log.errorDetails));
	});

	test("a non-stealth provider still receives the mid-stream read fault detail", async () => {
		await setupCreditsApiKey("nonstealth-token-stream-readfault");

		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer nonstealth-token-stream-readfault",
				"x-no-fallback": "true",
				"x-request-id": "nonstealth-stream-readfault-request",
			},
			body: JSON.stringify({
				model: "openai/gpt-4o-mini",
				stream: true,
				messages: [{ role: "user", content: "readfault leak check" }],
			}),
		});

		// The redaction must stay scoped to stealth providers: everyone else keeps
		// the buffered upstream body and the underlying failure detail, which is
		// what makes these errors debuggable.
		const text = await readSseText(res.body);
		expect(text).toContain(TRUNCATED_LEAKY_MARKER);
		expect(text).toContain("UND_ERR_SOCKET");
	});

	test("/v1/responses hides the raw upstream error", async () => {
		await setupCreditsApiKey("stealth-token-responses");

		const res = await app.request("/v1/responses", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer stealth-token-responses",
				"x-no-fallback": "true",
			},
			body: JSON.stringify({
				model: STEALTH_MODEL,
				input: "responses leak check",
			}),
		});

		expect(res.status).toBeGreaterThanOrEqual(400);
		expectNoLeak(await res.text());
	});

	test("/v1/messages hides the raw upstream error", async () => {
		await setupCreditsApiKey("stealth-token-messages");

		const res = await app.request("/v1/messages", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer stealth-token-messages",
				"x-no-fallback": "true",
			},
			body: JSON.stringify({
				model: STEALTH_MODEL,
				max_tokens: 128,
				messages: [{ role: "user", content: "messages leak check" }],
			}),
		});

		expect(res.status).toBeGreaterThanOrEqual(400);
		expectNoLeak(await res.text());
	});

	test("/v1/messages streaming hides the raw upstream error", async () => {
		await setupCreditsApiKey("stealth-token-messages-stream");

		const res = await app.request("/v1/messages", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer stealth-token-messages-stream",
				"x-no-fallback": "true",
			},
			body: JSON.stringify({
				model: STEALTH_MODEL,
				max_tokens: 128,
				stream: true,
				messages: [
					{ role: "user", content: "messages stream http500 leak check" },
				],
			}),
		});

		expectNoLeak(await readSseText(res.body));
	});

	test("/v1/images/generations hides the raw upstream error", async () => {
		await setupCreditsApiKey("stealth-token-images");

		const res = await app.request("/v1/images/generations", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer stealth-token-images",
				"x-no-fallback": "true",
			},
			body: JSON.stringify({
				model: "glacier/gemini-2.5-flash-image",
				prompt: "images leak check",
			}),
		});

		expect(res.status).toBeGreaterThanOrEqual(400);
		expectNoLeak(await res.text());
	});

	test("network errors do not leak the stealth base URL host", async () => {
		await setupCreditsApiKey("stealth-token-network");

		const originalBaseUrl = process.env.LLM_TUNDRA_BASE_URL;
		process.env.LLM_TUNDRA_BASE_URL = "http://secret-stealth-host.invalid:9999";
		try {
			const requestId = "stealth-network-request";
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer stealth-token-network",
					"x-no-fallback": "true",
					"x-request-id": requestId,
				},
				body: JSON.stringify({
					model: STEALTH_MODEL,
					messages: [{ role: "user", content: "network error leak check" }],
				}),
			});

			expect(res.status).toBeGreaterThanOrEqual(500);
			const text = await res.text();
			expect(text).not.toContain("secret-stealth-host");
			const json = JSON.parse(text);
			expect(json.error.message).toBe("Failed to connect to provider");
		} finally {
			process.env.LLM_TUNDRA_BASE_URL = originalBaseUrl;
		}
	});
});
