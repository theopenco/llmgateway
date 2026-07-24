import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { db, tables } from "@llmgateway/db";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import { waitForLogByRequestId } from "./test-utils/test-helpers.js";

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
				// "midstream" prompts get a valid delta chunk before the error.
				if (isStream && !body.includes("http500")) {
					res.writeHead(200, { "content-type": "text/event-stream" });
					if (body.includes("midstream")) {
						res.write(
							`data: ${JSON.stringify({
								id: "cmpl-1",
								object: "chat.completion.chunk",
								created: 1,
								model: "glm-5.2",
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
			"LLM_GRANITE_API_KEY",
			"LLM_GRANITE_BASE_URL",
			"LLM_GLACIER_API_KEY",
			"LLM_GLACIER_BASE_URL",
		]) {
			savedEnv[key] = process.env[key];
		}
		process.env.LLM_GRANITE_API_KEY = "granite-env-key";
		process.env.LLM_GRANITE_BASE_URL = leakyServerUrl;
		process.env.LLM_GLACIER_API_KEY = "glacier-env-key";
		process.env.LLM_GLACIER_BASE_URL = leakyServerUrl;
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
			token,
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

	async function expectRedactedLog(requestId: string) {
		const log = await waitForLogByRequestId(requestId);
		expect(log.hasError).toBe(true);
		expect(log.errorDetails).toBeTruthy();
		expectNoLeak(JSON.stringify(log.errorDetails));
		expect(log.internalErrorDetails).toBeTruthy();
		expect(JSON.stringify(log.internalErrorDetails)).toContain(SECRET_VENDOR);
		return log;
	}

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
				model: "granite/glm-5.2",
				messages: [{ role: "user", content: "nonstream leak check" }],
			}),
		});

		expect(res.status).toBe(500);
		const text = await res.text();
		expectNoLeak(text);
		const json = JSON.parse(text);
		expect(json.error.message).toBe(
			"Error from provider granite: 500 Internal Server Error",
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
				model: "granite/glm-5.2",
				stream: true,
				messages: [{ role: "user", content: "stream http500 leak check" }],
			}),
		});

		const text = await readSseText(res.body);
		expectNoLeak(text);
		expect(text).toContain(
			"Error from provider granite: 500 Internal Server Error",
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
				model: "granite/glm-5.2",
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
				model: "granite/glm-5.2",
				stream: true,
				messages: [{ role: "user", content: "midstream error leak check" }],
			}),
		});

		const text = await readSseText(res.body);
		expectNoLeak(text);
		expect(text).toContain("event: error");

		await expectRedactedLog(requestId);
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
				model: "granite/glm-5.2",
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
				model: "granite/glm-5.2",
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
				model: "granite/glm-5.2",
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

		const originalBaseUrl = process.env.LLM_GRANITE_BASE_URL;
		process.env.LLM_GRANITE_BASE_URL =
			"http://secret-stealth-host.invalid:9999";
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
					model: "granite/glm-5.2",
					messages: [{ role: "user", content: "network error leak check" }],
				}),
			});

			expect(res.status).toBeGreaterThanOrEqual(500);
			const text = await res.text();
			expect(text).not.toContain("secret-stealth-host");
			const json = JSON.parse(text);
			expect(json.error.message).toBe("Failed to connect to provider");
		} finally {
			process.env.LLM_GRANITE_BASE_URL = originalBaseUrl;
		}
	});
});
