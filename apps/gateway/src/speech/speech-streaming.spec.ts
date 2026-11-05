import { afterEach, describe, expect, test, vi } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";
import { waitForLogs } from "@/test-utils/test-helpers.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

const encode = (text: string) => new TextEncoder().encode(text);
const delta = (text: string) =>
	`data: ${JSON.stringify({ type: "speech.audio.delta", audio: Buffer.from(text).toString("base64") })}\n\n`;
const done = `data: ${JSON.stringify({ type: "speech.audio.done", usage: { input_tokens: 7, output_tokens: 42 } })}\n\n`;

function speechStreamingTests() {
	const harness = createGatewayApiTestHarness();
	afterEach(() => vi.restoreAllMocks());

	async function seed() {
		await db.insert(tables.apiKey).values({
			id: "speech-stream-key",
			description: "Streaming test key",
			...hashApiKeyForStorage("test-token-speech-stream"),
			projectId: "project-id",
			createdBy: "user-id",
		});
		await db.insert(tables.providerKey).values({
			id: "speech-stream-provider",
			...encryptProviderKeyForStorage(
				"azure-test-key",
				"speech-stream-provider",
				"org-id",
			),
			provider: "azure",
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
		});
	}

	function upstream(body: ReadableStream<Uint8Array>, sse: boolean) {
		const original = globalThis.fetch;
		return vi.spyOn(globalThis, "fetch").mockImplementation((input, init) =>
			String(input).endsWith("/audio/speech")
				? Promise.resolve(
						new Response(body, {
							headers: {
								"Content-Type": sse ? "text/event-stream" : "audio/mpeg",
							},
						}),
					)
				: original(input, init),
		);
	}

	function speak(
		model = "azure/gpt-4o-mini-tts",
		extra: Record<string, unknown> = {},
		signal?: AbortSignal,
	) {
		return app.request("/v1/audio/speech", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer test-token-speech-stream",
			},
			body: JSON.stringify({ model, input: "Hello streaming audio", ...extra }),
			signal,
		});
	}

	test.each([false, true])(
		"delivers audio before upstream completion (SSE %s)",
		async (sse) => {
			await seed();
			let finish!: () => void;
			const gate = new Promise<void>((resolve) => {
				finish = resolve;
			});
			upstream(
				new ReadableStream({
					async start(controller) {
						controller.enqueue(encode(sse ? delta("FIRST") : "FIRST"));
						await gate;
						controller.enqueue(encode(sse ? delta("SECOND") + done : "SECOND"));
						controller.close();
					},
				}),
				sse,
			);
			const pending = speak(sse ? "azure/gpt-4o-mini-tts" : "azure/tts-1");
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				const response = await Promise.race([
					pending,
					new Promise<never>((_, reject) => {
						timer = setTimeout(
							() =>
								reject(
									new Error("Speech response buffered until upstream EOF"),
								),
							1500,
						);
					}),
				]);
				expect(response.status).toBe(200);
				expect(response.headers.has("Content-Length")).toBe(false);
				const reader = response.body!.getReader();
				expect(Buffer.from((await reader.read()).value!).toString()).toBe(
					"FIRST",
				);
				finish();
				let rest = "";
				for (;;) {
					const chunk = await reader.read();
					if (chunk.done) {
						break;
					}
					rest += Buffer.from(chunk.value).toString();
				}
				expect(rest).toBe("SECOND");
				const [log] = await waitForLogs(1);
				expect(log).toMatchObject({
					streamed: true,
					canceled: false,
					hasError: false,
					responseSize: 11,
				});
				if (sse) {
					expect(log).toMatchObject({
						promptTokens: "7",
						completionTokens: "42",
						estimatedCost: false,
					});
				}
			} finally {
				clearTimeout(timer);
				finish();
				await pending;
			}
		},
	);
	test("forwards native SSE without re-encoding and logs terminal usage", async () => {
		await seed();
		const payload = delta("FIRST") + done;
		const spy = upstream(
			new ReadableStream({
				start(controller) {
					controller.enqueue(encode(payload));
					controller.close();
				},
			}),
			true,
		);
		const response = await speak("azure/gpt-4o-mini-tts", {
			stream_format: "sse",
			response_format: "mp3",
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("text/event-stream");
		expect(await response.text()).toBe(payload);
		const speechCall = spy.mock.calls.find(([url]) =>
			String(url).endsWith("/audio/speech"),
		);
		expect(JSON.parse(String(speechCall?.[1]?.body))).toMatchObject({
			stream_format: "sse",
			response_format: "mp3",
		});
		const [log] = await waitForLogs(1);
		expect(log).toMatchObject({
			promptTokens: "7",
			completionTokens: "42",
			estimatedCost: false,
			streamed: true,
		});
	});

	test("rejects SSE for legacy speech and retains string-only voice validation", async () => {
		await seed();
		const spy = vi.spyOn(globalThis, "fetch");
		for (const extra of [
			{ stream_format: "sse" },
			{ voice: { id: "custom-voice" } },
		]) {
			const response = await speak("azure/tts-1", extra);
			expect(response.status).toBe(400);
		}
		expect(
			spy.mock.calls.some(([url]) => String(url).endsWith("/audio/speech")),
		).toBe(false);
	});

	test("disconnect drains native usage and bills authorized generation exactly once", async () => {
		await seed();
		let source!: ReadableStreamDefaultController<Uint8Array>;
		upstream(
			new ReadableStream({
				start(controller) {
					source = controller;
					controller.enqueue(encode(delta("FIRST")));
				},
			}),
			true,
		);
		const response = await speak();
		const reader = response.body!.getReader();
		await reader.read();
		await reader.cancel();
		source.enqueue(encode(delta("DISCARDED") + done));
		source.close();
		const logs = await waitForLogs(1);
		expect(logs).toHaveLength(1);
		expect(logs[0]).toMatchObject({
			canceled: true,
			finishReason: "canceled",
			responseSize: 5,
			promptTokens: "7",
			completionTokens: "42",
			estimatedCost: false,
		});
		expect(Number(logs[0].outputCost)).toBeGreaterThan(0);
	});
	test("records truncated native usage as failed, estimated accounting", async () => {
		await seed();
		upstream(
			new ReadableStream({
				start(controller) {
					controller.enqueue(encode(delta("FIRST")));
					controller.close();
				},
			}),
			true,
		);
		const response = await speak();
		expect(response.status).toBe(200);
		await expect(response.arrayBuffer()).rejects.toThrow("before completion");
		const [log] = await waitForLogs(1);
		expect(log).toMatchObject({
			hasError: true,
			finishReason: "upstream_error",
			estimatedCost: true,
			promptTokens: null,
			completionTokens: null,
			responseSize: 5,
		});
		expect(Number(log.inputCost)).toBeGreaterThan(0);
	});

	test("character-priced cancellation retains accepted input billing", async () => {
		await seed();
		upstream(
			new ReadableStream({
				start(controller) {
					controller.enqueue(encode("FIRST"));
				},
			}),
			false,
		);
		const response = await speak("azure/tts-1");
		const reader = response.body!.getReader();
		await reader.read();
		await reader.cancel();
		const [log] = await waitForLogs(1);
		expect(log).toMatchObject({
			canceled: true,
			responseSize: 5,
			estimatedCost: false,
		});
		expect(Number(log.inputCost)).toBeGreaterThan(0);
	});
}

describe("native speech streaming", speechStreamingTests);
