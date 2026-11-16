import { Decimal } from "decimal.js";
import { afterEach, describe, expect, test, vi } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";
import { waitForLogs } from "@/test-utils/test-helpers.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

// Every billed reply reports its cost itself, with no opt-in headers: JSON
// bodies as `usage.cost`, streams in their final usage event, binary audio in
// a header or its completion event. Each must equal the logged cost.

const TOKEN = "usage-cost-token";

function post(path: string, body: unknown) {
	return app.request(path, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${TOKEN}`,
			"Content-Type": "application/json",
			"x-no-fallback": "true",
		},
		body: JSON.stringify(body),
	});
}

/** The logged cost of the request, to the precision the log stores. */
async function expectLoggedCost(cost: unknown) {
	expect(typeof cost).toBe("number");
	const logs = await waitForLogs(1);
	const billed = logs
		.filter((log) => !log.retried)
		.reduce((sum, log) => sum.plus(log.cost ?? 0), new Decimal(0));
	expect(billed.toNumber()).toBeGreaterThan(0);
	expect(
		billed
			.minus(cost as number)
			.abs()
			.lt(1e-10),
		`logged ${billed.toFixed()} vs reported ${String(cost)}`,
	).toBe(true);
}

function sseEvents(text: string): Array<Record<string, any>> {
	return text
		.split("\n")
		.filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
		.map((line) => JSON.parse(line.slice(6)) as Record<string, any>);
}

const encode = (text: string) => new TextEncoder().encode(text);
const speechDelta = (text: string) =>
	`data: ${JSON.stringify({ type: "speech.audio.delta", audio: Buffer.from(text).toString("base64") })}\n\n`;
const speechDone = `data: ${JSON.stringify({ type: "speech.audio.done", usage: { input_tokens: 7, output_tokens: 42, total_tokens: 49 } })}\n\n`;

describe("usage.cost on every reply", () => {
	const harness = createGatewayApiTestHarness();

	afterEach(() => {
		vi.restoreAllMocks();
	});

	async function seed(...providers: string[]) {
		await db.insert(tables.apiKey).values({
			id: "usage-cost-key",
			...hashApiKeyForStorage(TOKEN),
			projectId: "project-id",
			description: "Usage cost key",
			createdBy: "user-id",
		});
		for (const provider of providers) {
			const id = `usage-cost-${provider}`;
			await db.insert(tables.providerKey).values({
				id,
				...encryptProviderKeyForStorage(`${provider}-key`, id, "org-id"),
				provider,
				organizationId: "org-id",
				baseUrl: harness.mockServerUrl,
			});
		}
	}

	function mockGoogleImage() {
		const originalFetch = globalThis.fetch;
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			const url = new URL(
				typeof input === "string" || input instanceof URL ? input : input.url,
			);
			if (!url.href.startsWith(harness.mockServerUrl)) {
				return await originalFetch(input, init);
			}
			return Response.json({
				candidates: [
					{
						content: {
							parts: [
								{
									inlineData: {
										mimeType: "image/png",
										data: Buffer.from([
											0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
										]).toString("base64"),
									},
								},
							],
							role: "model",
						},
						finishReason: "STOP",
						index: 0,
					},
				],
				usageMetadata: {
					promptTokenCount: 10,
					candidatesTokenCount: 1120,
					totalTokenCount: 1130,
				},
			});
		});
	}

	describe("JSON replies", () => {
		test.each([
			[
				"/v1/chat/completions",
				"openai",
				{
					model: "openai/gpt-4o-mini",
					messages: [{ role: "user", content: "usage cost chat" }],
				},
			],
			[
				"/v1/messages",
				"openai",
				{
					model: "openai/gpt-4o-mini",
					max_tokens: 64,
					messages: [{ role: "user", content: "usage cost messages" }],
				},
			],
			[
				"/v1/responses",
				"openai",
				{ model: "openai/gpt-4o-mini", input: "usage cost responses" },
			],
			[
				"/v1/responses/compact",
				"openai",
				{
					model: "openai/gpt-4o-mini",
					input: [{ role: "user", content: "usage cost compact" }],
				},
			],
			[
				"/v1/embeddings",
				"openai",
				{ model: "openai/text-embedding-3-small", input: "usage cost embed" },
			],
			[
				"/v1/decisions",
				"openai",
				{
					model: "gpt-6-luna-decisions",
					input: [
						{
							role: "user",
							content: [{ type: "input_text", text: "Usage cost decision." }],
						},
					],
					questions: [
						{
							type: "predicate",
							name: "urgency",
							instructions: "Does the request describe an urgent problem?",
						},
					],
				},
			],
			[
				"/v1/moderations",
				"openai",
				{ model: "openai/openai-moderation", input: "usage cost moderation" },
			],
			[
				"/v1/rerank",
				"deepinfra",
				{
					model: "qwen3-reranker-0.6b",
					query: "usage cost rerank",
					documents: ["first document", "second document"],
				},
			],
			[
				"/v1/ocr",
				"mistral",
				{
					model: "mistral-ocr-latest",
					document: {
						type: "image_url",
						image_url: "https://example.com/PAGES_3.png",
					},
				},
			],
			["/v1/search", "perplexity", { query: "usage cost search" }],
		])("%s", async (path, provider, body) => {
			await seed(provider);
			const res = await post(path, body);
			const json = await res.json();
			expect(res.status, JSON.stringify(json)).toBe(200);
			expect(json.usage.cost_details).toBeTypeOf("object");
			await expectLoggedCost(json.usage.cost);
		});

		test.each(["generations", "edits"])("/v1/images/%s", async (endpoint) => {
			await seed("google-ai-studio");
			mockGoogleImage();
			const res = await post(`/v1/images/${endpoint}`, {
				model: "google-ai-studio/gemini-3-pro-image",
				prompt: "A blue circle",
				...(endpoint === "edits" && {
					images: [{ image_url: "data:image/png;base64,aGVsbG8=" }],
				}),
			});
			const json = await res.json();
			expect(res.status, JSON.stringify(json)).toBe(200);
			await expectLoggedCost(json.usage.cost);
		});

		test("/v1/audio/transcriptions", async () => {
			await seed("xai");
			const form = new FormData();
			form.append("model", "grok-stt-1-0");
			form.append(
				"file",
				new File([Buffer.from("MOCK_AUDIO_BYTES")], "audio.mp3", {
					type: "audio/mpeg",
				}),
			);
			const res = await app.request("/v1/audio/transcriptions", {
				method: "POST",
				headers: { Authorization: `Bearer ${TOKEN}`, "x-no-fallback": "true" },
				body: form,
			});
			const json = await res.json();
			expect(res.status, JSON.stringify(json)).toBe(200);
			expect(json.usage.cost_details.audio_input_cost).toBeGreaterThan(0);
			await expectLoggedCost(json.usage.cost);
		});
	});

	describe("streams carry the cost in their final usage event", () => {
		test.each([
			[
				"/v1/chat/completions",
				{
					model: "openai/gpt-4o-mini",
					stream: true,
					messages: [{ role: "user", content: "usage cost stream chat" }],
				},
				(events: Array<Record<string, any>>) =>
					[...events].reverse().find((event) => event.usage)?.usage.cost,
			],
			[
				"/v1/messages",
				{
					model: "openai/gpt-4o-mini",
					max_tokens: 64,
					stream: true,
					messages: [{ role: "user", content: "usage cost stream messages" }],
				},
				(events: Array<Record<string, any>>) =>
					events.find((event) => event.type === "message_delta")?.usage.cost,
			],
			[
				"/v1/responses",
				{
					model: "openai/gpt-4o-mini",
					stream: true,
					input: "usage cost stream responses",
				},
				(events: Array<Record<string, any>>) =>
					events.find((event) => event.type === "response.completed")?.response
						.usage.cost,
			],
		])("%s", async (path, body, finalCost) => {
			await seed("openai");
			const res = await post(path, body);
			expect(res.status).toBe(200);
			await expectLoggedCost(finalCost(sseEvents(await res.text())));
		});
	});

	describe("speech", () => {
		function upstream(body: ReadableStream<Uint8Array>, sse: boolean) {
			const original = globalThis.fetch;
			vi.spyOn(globalThis, "fetch").mockImplementation((input, init) =>
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

		/** The audio and final usage of a `stream_format: "sse"` reply. */
		async function speechEvents(res: Response) {
			expect(res.status).toBe(200);
			expect(res.headers.get("Content-Type")).toBe("text/event-stream");
			const events = sseEvents(await res.text());
			const done = events.at(-1)!;
			expect(done.type).toBe("speech.audio.done");
			const deltas = events.slice(0, -1);
			expect(deltas.length).toBeGreaterThan(0);
			for (const delta of deltas) {
				expect(delta.type).toBe("speech.audio.delta");
			}
			return {
				audio: Buffer.concat(
					deltas.map((delta) => Buffer.from(delta.audio, "base64")),
				),
				usage: done.usage as Record<string, any>,
			};
		}

		test.each([
			["openai", "tts-1", "MOCK_OPENAI_AUDIO"],
			["elevenlabs", "eleven-multilingual-v2", "MOCK_ELEVENLABS_AUDIO"],
		])(
			"character-priced %s audio streams events ending with its cost",
			async (provider, model, audio) => {
				await seed(provider);
				const input = "Hello usage cost";
				const events = await speechEvents(
					await post("/v1/audio/speech", {
						model,
						input,
						stream_format: "sse",
					}),
				);
				expect(events.audio.toString()).toBe(audio);
				expect(events.usage.input_characters).toBe(input.length);
				expect(events.usage.cost_details.input_cost).toBeGreaterThan(0);
				await expectLoggedCost(events.usage.cost);
			},
		);

		test.each([
			[
				"google-ai-studio",
				"gemini-2.5-flash-preview-tts",
				"input_tokens",
				"RIFF",
			],
			["alibaba", "qwen-audio-3.0-tts-plus", "input_characters", "MOCK"],
		])(
			"%s audio generated in one piece ends with its cost",
			async (provider, model, countField, magic) => {
				await seed(provider);
				const events = await speechEvents(
					await post("/v1/audio/speech", {
						model,
						input: "Hello there",
						stream_format: "sse",
					}),
				);
				expect(events.audio.subarray(0, 4).toString()).toBe(magic);
				expect(events.usage[countField]).toBeGreaterThan(0);
				await expectLoggedCost(events.usage.cost);
			},
		);

		test("binary audio is unchanged without stream_format", async () => {
			await seed("openai");
			const res = await post("/v1/audio/speech", {
				model: "tts-1",
				input: "Hello usage cost",
			});
			expect(res.status).toBe(200);
			expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
			expect(Buffer.from(await res.arrayBuffer()).toString()).toBe(
				"MOCK_OPENAI_AUDIO",
			);
			// Still billed; wait so the row does not land in the next test.
			await waitForLogs(1);
		});

		test("token-priced SSE audio reports its cost in speech.audio.done", async () => {
			await seed("azure");
			upstream(
				new ReadableStream({
					start(controller) {
						controller.enqueue(encode(speechDelta("FIRST")));
						controller.enqueue(encode(speechDelta("SECOND") + speechDone));
						controller.close();
					},
				}),
				true,
			);
			const res = await post("/v1/audio/speech", {
				model: "azure/gpt-4o-mini-tts",
				input: "Hello usage cost",
				stream_format: "sse",
			});
			expect(res.status).toBe(200);
			const events = sseEvents(await res.text());
			expect(events.map((event) => event.type)).toEqual([
				"speech.audio.delta",
				"speech.audio.delta",
				"speech.audio.done",
			]);
			const { usage } = events[2];
			expect(usage).toMatchObject({
				input_tokens: 7,
				output_tokens: 42,
				total_tokens: 49,
			});
			expect(usage.cost_details.output_cost).toBeGreaterThan(0);
			await expectLoggedCost(usage.cost);
		});
	});
});
