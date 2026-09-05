import { describe, expect, test } from "vitest";

import { prepareRequestBody } from "./prepare-request-body.js";

import type {
	BaseMessage,
	OpenAIRequestBody,
	ProviderId,
} from "@llmgateway/models";

async function prepare(
	provider: ProviderId,
	model: string,
	messages: BaseMessage[],
) {
	return (await prepareRequestBody(
		provider,
		model,
		null,
		provider === "novita" ? `zai-org/${model}` : model,
		messages,
		false,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
	)) as OpenAIRequestBody;
}

describe("Novita GLM-5.3 Flash content", () => {
	test.each([
		["novita", "glm-5.3-flash", true],
		["novita", "glm-5.3", false],
		["zai", "glm-5.3-flash", false],
	] as const)(
		"normalizes empty parts only for %s/%s",
		async (provider, model, stripsEmpty) => {
			const text = { type: "text", text: "Describe this image." } as const;
			const empty = { type: "text", text: "" } as const;
			const whitespace = { type: "text", text: " " } as const;
			const image = {
				type: "image_url",
				image_url: { url: "https://example.com/image.png" },
			} as const;
			const content = [text, empty, whitespace, image];
			const messages: BaseMessage[] = [{ role: "user", content }];
			const body = await prepare(provider, model, messages);
			expect(body.messages).toEqual([
				{
					role: "user",
					content: stripsEmpty ? [text, whitespace, image] : content,
				},
			]);
			expect(messages[0]?.content).toEqual([text, empty, whitespace, image]);
		},
	);

	test("preserves string content and entirely empty content arrays", async () => {
		const messages: BaseMessage[] = [
			{ role: "user", content: "Hello" },
			{ role: "assistant", content: "The answer is" },
			{ role: "user", content: [{ type: "text", text: "" }] },
		];
		const body = await prepare("novita", "glm-5.3-flash", messages);
		expect(body.messages).toEqual(messages);
	});
});
