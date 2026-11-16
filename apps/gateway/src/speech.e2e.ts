import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import {
	beforeAllHook,
	beforeEachHook,
	generateTestRequestId,
	getConcurrentTestOptions,
	getTestOptions,
	logMode,
	speechModels,
} from "@/chat-helpers.e2e.js";
import { waitForLogByRequestId } from "@/test-utils/test-helpers.js";

import { app } from "./app.js";

describe("e2e speech", getConcurrentTestOptions(), () => {
	beforeAll(beforeAllHook);
	beforeEach(beforeEachHook);

	test("empty", () => {
		expect(true).toBe(true);
	});

	test.each(speechModels)(
		"speech $model",
		getTestOptions(),
		async ({ model }) => {
			const requestId = generateTestRequestId();
			const res = await app.request("/v1/audio/speech", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-request-id": requestId,
					Authorization: `Bearer real-token`,
				},
				body: JSON.stringify({
					model,
					input: "Hello from the LLM Gateway end-to-end speech test.",
					response_format: "wav",
				}),
			});

			if (res.status !== 200) {
				const errorBody = await res.text();
				if (logMode) {
					console.log("speech error response:", errorBody);
				}
				expect(res.status, errorBody).toBe(200);
			}

			const contentType = res.headers.get("Content-Type") ?? "";
			expect(contentType).toContain("audio/");

			const bytes = Buffer.from(await res.arrayBuffer());
			if (logMode) {
				console.log(
					`speech response: ${bytes.length} bytes, content-type ${contentType}`,
				);
			}
			// A WAV file starts with a RIFF header and must carry actual audio
			// samples beyond the 44-byte header.
			expect(bytes.length).toBeGreaterThan(44);
			expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
			expect(bytes.subarray(8, 12).toString("ascii")).toBe("WAVE");
		},
	);
});

const openaiSpeechModels = speechModels.filter(
	({ provider }) =>
		provider.providerId === "openai" || provider.providerId === "azure",
);
const speechCapabilityCases =
	process.env.FULL_MODE === "true"
		? openaiSpeechModels.flatMap((entry) => [
				...(entry.provider.supportedVoices ?? []).map((voice) => ({
					...entry,
					capability: voice,
					params: { voice, response_format: "wav" },
				})),
				...["mp3", "opus", "aac", "flac", "pcm"].map((response_format) => ({
					...entry,
					capability: response_format,
					params: { response_format },
				})),
				...[0.25, 4].map((speed) => ({
					...entry,
					capability: "speed " + speed,
					params: { speed, response_format: "wav" },
				})),
				...(entry.provider.inputCharacterPrice === undefined
					? [
							{
								...entry,
								capability: "instructions",
								params: {
									instructions: "Speak cheerfully.",
									response_format: "wav",
								},
							},
						]
					: []),
			])
		: [];
describe(
	"e2e OpenAI-compatible speech capabilities",
	getConcurrentTestOptions(),
	() => {
		beforeAll(beforeAllHook);
		beforeEach(beforeEachHook);
		test.each(speechCapabilityCases)(
			"speech $model $capability",
			getTestOptions(),
			async ({ model, params }) => {
				const res = await app.request("/v1/audio/speech", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: "Bearer real-token",
					},
					body: JSON.stringify({ model, input: "Hello.", ...params }),
				});
				if (res.status !== 200) {
					expect(res.status, await res.text()).toBe(200);
				}
				expect(res.headers.get("Content-Type")).toContain("audio/");
				const bytes = Buffer.from(await res.arrayBuffer());
				expect(bytes.length).toBeGreaterThan(44);
				if (params.response_format === "wav") {
					expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
					expect(bytes.toString("ascii", 8, 12)).toBe("WAVE");
				} else if (params.response_format === "flac") {
					expect(bytes.toString("ascii", 0, 4)).toBe("fLaC");
				} else if (params.response_format === "opus") {
					expect(bytes.toString("ascii", 0, 4)).toBe("OggS");
				}
			},
		);
	},
);

const speechStreamingCases =
	process.env.FULL_MODE === "true"
		? openaiSpeechModels
				.filter(({ provider }) => provider.inputCharacterPrice === undefined)
				.flatMap((entry) =>
					["mp3", "opus", "aac", "flac", "wav", "pcm"].map(
						(response_format) => ({ ...entry, response_format }),
					),
				)
		: [];

describe.skipIf(speechStreamingCases.length === 0)(
	"e2e native speech SSE",
	getConcurrentTestOptions(),
	() => {
		beforeAll(beforeAllHook);
		beforeEach(beforeEachHook);
		test.each(speechStreamingCases)(
			"speech SSE $model $response_format",
			getTestOptions(),
			async ({ model, response_format }) => {
				const requestId = generateTestRequestId();
				const response = await app.request("/v1/audio/speech", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-request-id": requestId,
						Authorization: "Bearer real-token",
					},
					body: JSON.stringify({
						model,
						input:
							"Hello from the streaming speech test. Audio arrives as it is generated.",
						response_format,
						stream_format: "sse",
					}),
				});
				if (response.status !== 200) {
					expect(response.status, await response.text()).toBe(200);
				}
				expect(response.headers.get("Content-Type")).toBe("text/event-stream");
				expect(response.headers.has("Content-Length")).toBe(false);
				const reader = response.body!.getReader();
				let text = "";
				let chunks = 0;
				const decoder = new TextDecoder();
				for (;;) {
					const chunk = await reader.read();
					if (chunk.done) {
						break;
					}
					chunks++;
					text += decoder.decode(chunk.value, { stream: true });
				}
				text += decoder.decode();
				const events = text
					.replaceAll("\r\n", "\n")
					.split("\n\n")
					.map((frame) =>
						frame
							.split("\n")
							.filter((line) => line.startsWith("data:"))
							.map((line) => line.slice(5).trimStart())
							.join("\n"),
					)
					.filter((data) => data && data !== "[DONE]")
					.map(
						(data) =>
							JSON.parse(data) as {
								type: string;
								audio?: string;
								usage?: { input_tokens: number; output_tokens: number };
							},
					);
				expect(chunks).toBeGreaterThan(0);
				expect(
					events.some(
						(event) =>
							event.type === "speech.audio.delta" &&
							Buffer.from(event.audio ?? "", "base64").length > 0,
					),
				).toBe(true);
				const usage = events.find(
					(event) => event.type === "speech.audio.done",
				)?.usage;
				expect(usage?.input_tokens).toBeGreaterThan(0);
				expect(usage?.output_tokens).toBeGreaterThan(0);
				const log = await waitForLogByRequestId(requestId);
				expect(log).toMatchObject({
					streamed: true,
					hasError: false,
					canceled: false,
					estimatedCost: false,
					promptTokens: String(usage?.input_tokens),
					completionTokens: String(usage?.output_tokens),
				});
			},
		);
	},
);
