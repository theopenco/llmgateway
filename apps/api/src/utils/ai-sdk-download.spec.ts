import { streamText } from "ai";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import { expect, test, vi } from "vitest";

import { deferDownloadsToGateway } from "@llmgateway/shared/ai-sdk-download";

test("message URLs reach the model as URLs, never fetched in process", async () => {
	const fetchSpy = vi.spyOn(globalThis, "fetch");
	const prompts: unknown[] = [];
	const model = new MockLanguageModelV4({
		doStream: async ({ prompt }) => {
			prompts.push(prompt);
			return {
				stream: convertArrayToReadableStream([
					{
						type: "finish",
						finishReason: { unified: "stop", raw: "stop" },
						usage: {
							inputTokens: {
								total: 1,
								noCache: 1,
								cacheRead: 0,
								cacheWrite: 0,
							},
							outputTokens: { total: 0, text: 0, reasoning: 0 },
						},
					},
				]),
			};
		},
	});
	const url = "http://metadata.google.internal/computeMetadata/v1/";
	const result = streamText({
		model,
		experimental_download: deferDownloadsToGateway,
		messages: [
			{
				role: "user",
				content: [
					{ type: "text", text: "hi" },
					{ type: "file", mediaType: "application/pdf", data: new URL(url) },
				],
			},
		],
	});
	await result.consumeStream();
	expect(fetchSpy).not.toHaveBeenCalled();
	expect(JSON.stringify(prompts)).toContain(url);
	fetchSpy.mockRestore();
});
