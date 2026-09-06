import { describe, expect, it } from "vitest";

import {
	buildGoogleReasoningDetails,
	preserveGoogleResponseText,
	restoreGoogleReasoningDetails,
} from "./google-thought-signatures.js";
import { prepareRequestBody } from "./prepare-request-body.js";
import { transformGoogleMessages } from "./transform-google-messages.js";

import type { BaseMessage } from "@llmgateway/models";

describe("Gemini signed text parts", () => {
	it("restores separate signed answers, thoughts, and empty parts", () => {
		const parts = [
			{ text: "summary", thought: true, thoughtSignature: "thought-signature" },
			{ text: "first", thoughtSignature: "first-signature" },
			{ text: " then " },
			{ text: "second", thoughtSignature: "first-signature" },
			{ text: "", thoughtSignature: "empty-signature" },
		];
		expect(
			restoreGoogleReasoningDetails(
				[{ text: "first then second" }],
				buildGoogleReasoningDetails(parts),
			),
		).toEqual(parts);
	});

	it("keeps streaming offsets and indexes across chunks", () => {
		const state = { textOffset: 0, index: 0 };
		const details = [
			...buildGoogleReasoningDetails([{ text: "prefix " }], state),
			...buildGoogleReasoningDetails(
				[{ text: "answer", thought_signature: "answer-signature" }],
				state,
			),
			...buildGoogleReasoningDetails(
				[{ text: "", thoughtSignature: "final-signature" }],
				state,
			),
		];
		expect(details.map((detail) => detail.index)).toEqual([0, 1]);
		expect(
			restoreGoogleReasoningDetails([{ text: "prefix answer" }], details),
		).toEqual([
			{ text: "prefix " },
			{ text: "answer", thoughtSignature: "answer-signature" },
			{ text: "", thoughtSignature: "final-signature" },
		]);
	});

	it("replays original signed JSON while keeping client edits authoritative", () => {
		const parts = [
			{ text: '{"answer":' },
			{ text: "42}}", thoughtSignature: "json-signature" },
		];
		const details = preserveGoogleResponseText(
			buildGoogleReasoningDetails(parts),
			'{"answer":42}}',
			'{"answer":42}',
		);
		expect(
			restoreGoogleReasoningDetails([{ text: '{"answer":42}' }], details),
		).toEqual(parts);
		expect(
			restoreGoogleReasoningDetails([{ text: '{"answer":43}' }], details),
		).toEqual([{ text: '{"answer":43}' }]);
	});

	it("accepts signature-only OpenRouter details and ignores foreign formats", async () => {
		const result = await transformGoogleMessages([
			{
				role: "assistant",
				content: "Answer",
				reasoning_details: [
					{
						type: "reasoning.text",
						format: "anthropic-claude-v1",
						signature: "foreign",
					},
					{
						type: "reasoning.text",
						format: "google-gemini-v1",
						signature: "google-signature",
					},
				],
			},
		]);
		expect(result[0]!.parts).toEqual([
			{ text: "Answer" },
			{ text: "", thoughtSignature: "google-signature" },
		]);
	});

	it("does not replay signatures from user messages or changed answer text", async () => {
		const details = buildGoogleReasoningDetails([
			{ text: "Original", thoughtSignature: "test-signature" },
		]);
		const result = await transformGoogleMessages([
			{ role: "user", content: "Original", reasoning_details: details },
			{ role: "assistant", content: "Changed", reasoning_details: details },
		]);
		expect(result.map((message) => message.parts)).toEqual([
			[{ text: "Original" }],
			[{ text: "Changed" }],
		]);
	});

	it("does not duplicate an explicitly signed content part", async () => {
		const details = buildGoogleReasoningDetails([
			{ text: "Answer", thoughtSignature: "test-signature" },
		]);
		const result = await transformGoogleMessages([
			{
				role: "assistant",
				content: [
					{
						type: "text",
						text: "Answer",
						extra_content: { google: { thought_signature: "test-signature" } },
					},
				],
				reasoning_details: details,
			},
		]);
		expect(result[0]!.parts).toEqual([
			{ text: "Answer", thoughtSignature: "test-signature" },
		]);
	});

	it("keeps tool signatures on function calls", async () => {
		const parts = [
			{ functionCall: { name: "lookup" }, thoughtSignature: "tool-signature" },
		];
		expect(buildGoogleReasoningDetails(parts)).toEqual([]);
		const result = await transformGoogleMessages([
			{
				role: "assistant",
				content: "",
				tool_calls: [
					{
						id: "call_test",
						type: "function",
						function: { name: "lookup", arguments: "{}" },
						extra_content: { google: { thought_signature: "tool-signature" } },
					},
				],
			},
		]);
		expect(result[0]!.parts).toEqual([
			{
				functionCall: { name: "lookup", args: {} },
				thoughtSignature: "tool-signature",
			},
		]);
	});

	it("matches explicit signatures by part, not signature value", () => {
		const parts = [
			{ text: "first", thoughtSignature: "shared-signature" },
			{ text: "second", thoughtSignature: "shared-signature" },
			{ text: "", thoughtSignature: "shared-signature" },
		];
		expect(
			restoreGoogleReasoningDetails(
				[parts[0]!, { text: "second" }],
				buildGoogleReasoningDetails(parts),
			),
		).toEqual(parts);
		// Details can describe only the parts not already signed explicitly.
		expect(
			restoreGoogleReasoningDetails(
				[parts[0]!, { text: "second" }],
				buildGoogleReasoningDetails(parts).slice(1),
			),
		).toEqual(parts);
	});

	it("restores a signed thought before tool calls without answer text", async () => {
		const thought = {
			text: "I should look this up.",
			thought: true,
			thoughtSignature: "thought-signature",
		};
		const result = await transformGoogleMessages([
			{
				role: "assistant",
				content: "",
				reasoning_details: buildGoogleReasoningDetails([thought]),
				tool_calls: [
					{
						id: "call_test",
						type: "function",
						function: { name: "lookup", arguments: "{}" },
					},
				],
			},
		]);
		expect(result[0]!.parts).toEqual([
			thought,
			{ functionCall: { name: "lookup", args: {} } },
		]);
	});

	it("retains reasoning details through Google request preparation only", async () => {
		const messages: BaseMessage[] = [
			{
				role: "assistant",
				// HTTP requests accept null content; BaseMessage is narrower.
				content: null as unknown as string,
				reasoning_details: [
					{
						type: "reasoning.encrypted",
						format: "openai-responses-v1",
						data: "foreign-payload",
					},
				],
			},
			{
				role: "assistant",
				content: "Answer",
				reasoning_details: buildGoogleReasoningDetails([
					{ text: "Answer", thoughtSignature: "test-signature" },
				]),
			},
		];
		const google = await prepareRequestBody(
			"google-ai-studio",
			"gemini-3.5-flash",
			null,
			"gemini-3.5-flash",
			messages,
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
		);
		expect(google).toMatchObject({
			contents: [
				{
					role: "model",
					parts: [{ text: "Answer", thoughtSignature: "test-signature" }],
				},
			],
		});
		const openai = await prepareRequestBody(
			"openai",
			"gpt-4o",
			null,
			"gpt-4o",
			messages,
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
		);
		expect("messages" in openai && openai.messages).toEqual([
			{ role: "assistant", content: "Answer" },
		]);
	});
});

describe("Gemini signed part metadata", () => {
	it("stores a length and hash instead of copying answer text", () => {
		const [answer, thought] = buildGoogleReasoningDetails([
			{ text: "The answer is 42.", thoughtSignature: "answer-signature" },
			{ text: "Reasoning.", thought: true, thoughtSignature: "thought-sig" },
		]);
		expect(answer).not.toHaveProperty("text");
		expect(answer!.google_part).toEqual({
			thought: false,
			text_offset: 0,
			text_length: 17,
			text_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
		});
		expect(thought).toMatchObject({
			text: "Reasoning.",
			google_part: { thought: true, text_offset: 17 },
		});
	});

	it("does not reattach an answer signature to edited text of equal length", () => {
		const details = buildGoogleReasoningDetails([
			{ text: "Answer: 42", thoughtSignature: "answer-signature" },
		]);
		expect(
			restoreGoogleReasoningDetails([{ text: "Answer: 43" }], details),
		).toEqual([{ text: "Answer: 43" }]);
		expect(
			restoreGoogleReasoningDetails([{ text: "Answer: 42" }], details),
		).toEqual([{ text: "Answer: 42", thoughtSignature: "answer-signature" }]);
	});

	it("skips malformed metadata instead of guessing a position", () => {
		expect(
			restoreGoogleReasoningDetails(
				[{ text: "Answer" }],
				[
					{
						type: "reasoning.text",
						format: "google-gemini-v1",
						signature: "bad-signature",
						google_part: { thought: false, text_offset: 0 },
					},
				],
			),
		).toEqual([{ text: "Answer" }]);
	});
});
