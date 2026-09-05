import { describe, expect, it } from "vitest";

import {
	buildGoogleReasoningDetails,
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
			{ text: "second", thoughtSignature: "second-signature" },
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

	it("retains reasoning details through Google request preparation only", async () => {
		const messages: BaseMessage[] = [
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
