import { describe, expect, test } from "vitest";

import { liftToolResultImages } from "./lift-tool-result-images.js";
import { prepareRequestBody } from "./prepare-request-body.js";

import type { BaseMessage, ProviderId } from "@llmgateway/models";

const DATA = "iVBORw0KGgo=";
const IMAGE = {
	type: "image_url" as const,
	image_url: { url: `data:image/png;base64,${DATA}` },
};
const call = (id: string) => ({
	id,
	type: "function" as const,
	function: { name: "screenshot", arguments: "{}" },
});

function history(): BaseMessage[] {
	return [
		{ role: "user", content: "Take two screenshots." },
		{
			role: "assistant",
			content: "",
			tool_calls: [call("call_1"), call("call_2")],
		},
		{
			role: "tool",
			tool_call_id: "call_1",
			name: "screenshot",
			content: [{ type: "text", text: "First." }, IMAGE],
		},
		{ role: "tool", tool_call_id: "call_2", name: "screenshot", content: "ok" },
		{ role: "user", content: "Describe them." },
	];
}

async function prepare(
	provider: ProviderId,
	model: string,
	useResponsesApi?: boolean,
): Promise<any> {
	const args: unknown[] = [provider, model, null, model, history(), false];
	args[25] = useResponsesApi;
	return await (
		prepareRequestBody as (
			...a: unknown[]
		) => ReturnType<typeof prepareRequestBody>
	)(...args);
}

describe("liftToolResultImages", () => {
	test("moves images after the tool run into the following user message", () => {
		const input = history();
		const original = structuredClone(input);

		expect(liftToolResultImages(input).slice(2)).toEqual([
			{
				role: "tool",
				tool_call_id: "call_1",
				name: "screenshot",
				content: [{ type: "text", text: "First." }],
			},
			{
				role: "tool",
				tool_call_id: "call_2",
				name: "screenshot",
				content: "ok",
			},
			{
				role: "user",
				content: [
					{ type: "text", text: "Image output of tool call call_1:" },
					IMAGE,
					{ type: "text", text: "Describe them." },
				],
			},
		]);
		expect(input).toEqual(original);
	});

	test("adds a user message when none follows, and a placeholder for an image-only result", () => {
		const lifted = liftToolResultImages([
			{ role: "assistant", content: "", tool_calls: [call("call_1")] },
			{ role: "tool", tool_call_id: "call_1", content: [IMAGE] },
			{ role: "assistant", content: "Seen." },
		]);

		expect(lifted.map((m) => m.role)).toEqual([
			"assistant",
			"tool",
			"user",
			"assistant",
		]);
		expect(typeof lifted[1]!.content).toBe("string");
		expect(lifted[2]!.content).toEqual([
			{ type: "text", text: "Image output of tool call call_1:" },
			IMAGE,
		]);
	});

	test("leaves messages without tool-result images untouched", () => {
		const input: BaseMessage[] = [{ role: "user", content: "hi" }];
		expect(liftToolResultImages(input)).toBe(input);
	});
});

describe("tool-result images per upstream format", () => {
	test("Chat Completions keeps only text on the tool message", async () => {
		const body = await prepare("openai", "gpt-4o-mini", false);
		const tool = body.messages.find((m: any) => m.tool_call_id === "call_1");

		expect(tool.content).toEqual([{ type: "text", text: "First." }]);
		expect(body.messages.at(-1).content).toContainEqual(IMAGE);
	});

	test("Xiaomi gets a string tool message and the image in the user turn", async () => {
		const body = await prepare("xiaomi", "mimo-v2.6-flash");
		const tool = body.messages.find((m: any) => m.tool_call_id === "call_1");

		expect(tool.content).toBe("First.");
		expect(body.messages.at(-1).content).toContainEqual(IMAGE);
	});

	test("Responses sends the image as an input_image in the call output", async () => {
		const body = await prepare("openai", "gpt-4.1", true);
		const output = body.input.find(
			(item: any) =>
				item.type === "function_call_output" && item.call_id === "call_1",
		).output;

		expect(output).toEqual([
			{ type: "input_text", text: "First." },
			{ type: "input_image", image_url: IMAGE.image_url.url },
		]);
	});

	test("Gemini sends the image as inline_data after its functionResponse", async () => {
		const body = await prepare("google-ai-studio", "gemini-3.5-flash");
		const parts = body.contents.find((c: any) =>
			c.parts.some((p: any) => p.functionResponse),
		).parts;

		expect(parts[0].functionResponse.response.result).toEqual([
			{ type: "text", text: "First." },
		]);
		expect(parts[1]).toEqual({
			inline_data: { mime_type: "image/png", data: DATA },
		});
		expect(parts[2].functionResponse.response.result).toBe("ok");
		expect(JSON.stringify(body.contents)).not.toContain("image_url");
	});
});

test("lifting conserves images and complete parallel turns across generated histories", () => {
	for (let sample = 1; sample <= 100; sample++) {
		const input: BaseMessage[] = [{ role: "user", content: "Start." }];
		let imageCount = 0;
		for (let turn = 0; turn < 3; turn++) {
			const calls = Array.from({ length: (sample % 4) + 1 }, (_, index) =>
				call(`call_${turn}_${index}`),
			);
			input.push({ role: "assistant", content: "", tool_calls: calls });
			for (const toolCall of calls) {
				const images = sample % 3 ? [IMAGE] : [];
				imageCount += images.length;
				input.push({
					role: "tool",
					tool_call_id: toolCall.id,
					content: [{ type: "text", text: toolCall.id }, ...images],
				});
			}
			if (sample % 2) {
				input.push({ role: "user", content: "Continue." });
			}
		}
		const original = structuredClone(input);
		const lifted = liftToolResultImages(input);
		expect(input).toEqual(original);
		expect(liftToolResultImages(lifted)).toEqual(lifted);
		expect(
			lifted.flatMap((message) =>
				Array.isArray(message.content)
					? message.content.filter((part) => part.type === "image_url")
					: [],
			),
		).toHaveLength(imageCount);
		let pending = new Set<string>();
		for (const message of lifted) {
			if (message.role === "assistant" && message.tool_calls) {
				expect(pending.size).toBe(0);
				pending = new Set(message.tool_calls.map((toolCall) => toolCall.id));
			} else if (message.role === "tool") {
				expect(pending.delete(message.tool_call_id!)).toBe(true);
			} else {
				expect(pending.size).toBe(0);
			}
		}
		expect(pending.size).toBe(0);
	}
});
