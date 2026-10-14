import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/app.js";
import {
	beforeAllHook,
	beforeEachHook,
	generateTestRequestId,
	getConcurrentTestOptions,
	getTestOptions,
	streamingToolCallModels,
	validateLogByRequestId,
} from "@/chat-helpers.e2e.js";
import { readAll } from "@/test-utils/test-helpers.js";

const imageToolModels = streamingToolCallModels.filter(({ providers }) =>
	providers.some((provider) => provider.vision === true),
);

for (const stream of [false, true]) {
	describe(
		`tool-result images (stream=${stream})`,
		getConcurrentTestOptions(),
		() => {
			beforeAll(beforeAllHook);
			beforeEach(beforeEachHook);

			test.each(imageToolModels)(
				"preserves images across consecutive tool results for $model",
				getTestOptions(),
				async ({ model, providers }) => {
					const requestId = generateTestRequestId();
					const response = await app.request("/v1/chat/completions", {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							"x-request-id": requestId,
							"x-no-fallback": "true",
							Authorization: "Bearer real-token",
						},
						body: JSON.stringify({
							model,
							stream,
							messages: [
								{
									role: "user",
									content: `Inspect the image returned by the tool and identify the single capital letter visible. Reply with only that letter. Request ${requestId}.`,
								},
								{
									role: "assistant",
									content: "",
									tool_calls: [
										{
											id: "image-result",
											type: "function",
											function: { name: "read_image", arguments: "{}" },
										},
										{
											id: "text-result",
											type: "function",
											function: { name: "read_image", arguments: "{}" },
										},
									],
								},
								{
									role: "tool",
									tool_call_id: "image-result",
									content: [
										{ type: "text", text: "Inspect the attached image." },
										{
											type: "image_url",
											image_url: {
												url: "https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://google.com&size=128",
											},
										},
									],
								},
								{
									role: "tool",
									tool_call_id: "text-result",
									content: "The image is the only source of the answer.",
								},
							],
							tools: [
								{
									type: "function",
									function: {
										name: "read_image",
										description: "Read an image",
										parameters: { type: "object", properties: {} },
									},
								},
							],
						}),
					});
					expect(response.status).toBe(200);
					let content: string;
					if (stream) {
						const result = await readAll(response.body);
						expect(result.hasValidSSE).toBe(true);
						expect(result.hasContent).toBe(true);
						content = result.chunks
							.map((chunk) => chunk.choices?.[0]?.delta?.content ?? "")
							.join("");
					} else {
						const result = await response.json();
						content = result.choices[0].message.content;
					}
					expect(content.trim()).toMatch(/^G[.!]?$/);
					const log = await validateLogByRequestId(requestId);
					expect(
						providers
							.filter((provider) => provider.vision === true)
							.map((provider) => provider.providerId),
					).toContain(log.usedProvider);
					expect(log.streamed).toBe(stream);
				},
			);
		},
	);
}
