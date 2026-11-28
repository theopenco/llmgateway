import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";

import { convertChatResponseToCompaction } from "./tools/convert-chat-to-compaction.js";
import { convertResponsesInputToMessages } from "./tools/convert-responses-to-chat.js";

type Input = Parameters<typeof convertResponsesInputToMessages>[0];

function userMessage(content: Array<Record<string, unknown>>): Input {
	return [{ type: "message", role: "user", content }] as Input;
}

describe("convertResponsesInputToMessages content parts", () => {
	it("maps input_file with file_data to a chat file part", () => {
		const [message] = convertResponsesInputToMessages(
			userMessage([
				{
					type: "input_file",
					filename: "doc.pdf",
					file_data: "data:application/pdf;base64,AAAA",
				},
			]),
		);
		expect(message!.content).toEqual([
			{
				type: "file",
				file: {
					filename: "doc.pdf",
					file_data: "data:application/pdf;base64,AAAA",
				},
			},
		]);
	});

	it("maps input_file with file_id to a chat file part", () => {
		const [message] = convertResponsesInputToMessages(
			userMessage([{ type: "input_file", file_id: "file-abc" }]),
		);
		expect(message!.content).toEqual([
			{ type: "file", file: { file_id: "file-abc" } },
		]);
	});

	it("rejects input_file with only file_url", () => {
		expect(() =>
			convertResponsesInputToMessages(
				userMessage([
					{ type: "input_file", file_url: "https://example.com/doc.pdf" },
				]),
			),
		).toThrow(HTTPException);
	});

	it("rejects input_image without image_url", () => {
		expect(() =>
			convertResponsesInputToMessages(
				userMessage([{ type: "input_image", file_id: "file-img" }]),
			),
		).toThrow(HTTPException);
	});

	it("maps input_image detail original to high", () => {
		const [message] = convertResponsesInputToMessages(
			userMessage([
				{
					type: "input_image",
					image_url: "https://example.com/a.png",
					detail: "original",
				},
			]),
		);
		expect(message!.content).toEqual([
			{
				type: "image_url",
				image_url: { url: "https://example.com/a.png", detail: "high" },
			},
		]);
	});
});

describe("compaction round trip", () => {
	const history = [
		{ type: "message", role: "user", content: "Plan the launch." },
		{ type: "message", role: "assistant", content: "Launch is Tuesday." },
		{
			type: "function_call",
			call_id: "call_1",
			name: "notify",
			arguments: "{}",
		},
		{ type: "function_call_output", call_id: "call_1", output: "sent" },
		{ type: "message", role: "user", content: "Notify support first." },
	];

	it("replays the summary and fewer messages than the original history", () => {
		const compacted = convertChatResponseToCompaction(
			{
				choices: [
					{ message: { content: "Launch Tuesday; support notified first." } },
				],
			},
			history,
			"resp_compact",
			1_700_000_000,
		);

		const original = convertResponsesInputToMessages(history as Input);
		const replayed = convertResponsesInputToMessages(compacted.output as Input);

		expect(replayed.length).toBeLessThan(original.length);
		expect(replayed.some((m) => m.role === "assistant")).toBe(false);
		expect(replayed.at(-1)).toEqual({
			role: "user",
			content:
				"Summary of the earlier conversation:\nLaunch Tuesday; support notified first.",
		});
	});

	it("skips compaction items the gateway did not create", () => {
		const messages = convertResponsesInputToMessages([
			{
				type: "compaction",
				id: "foreign_1",
				encrypted_content: "opaque-provider-blob",
			},
			{
				type: "compaction",
				id: "cmp_68c0ffee1234",
				encrypted_content: Buffer.from("upstream summary").toString("base64"),
			},
		] as Input);
		expect(messages).toEqual([]);
	});

	it("marks gateway compaction items with the gateway id prefix", () => {
		const compacted = convertChatResponseToCompaction(
			{ choices: [{ message: { content: "summary" } }] },
			history,
			"resp_compact",
			1_700_000_000,
		);
		const item = compacted.output.find(
			(entry) => (entry as { type?: string }).type === "compaction",
		) as { id: string };
		expect(item.id).toMatch(/^cmp_gw_/);
	});
});
