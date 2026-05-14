import { describe, expect, it } from "vitest";

import { models } from "@llmgateway/models";

import {
	getAudioFormatsFromMessages,
	messagesContainAudio,
} from "./messages-contain-audio.js";

import type { BaseMessage, ProviderModelMapping } from "@llmgateway/models";

describe("messagesContainAudio", () => {
	it("returns false for plain text-only messages", () => {
		const msgs: BaseMessage[] = [{ role: "user", content: "hello" }];
		expect(messagesContainAudio(msgs)).toBe(false);
	});

	it("returns false for image-only multipart content", () => {
		const msgs: BaseMessage[] = [
			{
				role: "user",
				content: [
					{ type: "text", text: "describe this" },
					{ type: "image_url", image_url: { url: "data:image/png;base64,A" } },
				],
			},
		];
		expect(messagesContainAudio(msgs)).toBe(false);
	});

	it("returns true when any part is input_audio", () => {
		const msgs: BaseMessage[] = [
			{
				role: "user",
				content: [
					{ type: "text", text: "transcribe" },
					{
						type: "input_audio",
						input_audio: { data: "AAAA", format: "wav" },
					},
				],
			},
		];
		expect(messagesContainAudio(msgs)).toBe(true);
	});

	it("returns true even when audio is in a later message", () => {
		const msgs: BaseMessage[] = [
			{ role: "system", content: "be terse" },
			{ role: "user", content: "hi" },
			{
				role: "user",
				content: [
					{
						type: "input_audio",
						input_audio: { data: "AAAA", format: "mp3" },
					},
				],
			},
		];
		expect(messagesContainAudio(msgs)).toBe(true);
	});
});

describe("getAudioFormatsFromMessages", () => {
	it("returns empty for non-audio messages", () => {
		const msgs: BaseMessage[] = [{ role: "user", content: "hello" }];
		expect(getAudioFormatsFromMessages(msgs)).toEqual([]);
	});

	it("returns the format from a single audio block", () => {
		const msgs: BaseMessage[] = [
			{
				role: "user",
				content: [
					{
						type: "input_audio",
						input_audio: { data: "AAAA", format: "wav" },
					},
				],
			},
		];
		expect(getAudioFormatsFromMessages(msgs)).toEqual(["wav"]);
	});

	it("deduplicates across multiple audio blocks", () => {
		const msgs: BaseMessage[] = [
			{
				role: "user",
				content: [
					{
						type: "input_audio",
						input_audio: { data: "A", format: "mp3" },
					},
					{
						type: "input_audio",
						input_audio: { data: "B", format: "mp3" },
					},
					{
						type: "input_audio",
						input_audio: { data: "C", format: "m4a" },
					},
				],
			},
		];
		const formats = getAudioFormatsFromMessages(msgs);
		expect(formats.sort()).toEqual(["m4a", "mp3"]);
	});
});

describe("Gemini audio capability flag", () => {
	const expectedAudioFlashModelIds = [
		"gemini-2.0-flash",
		"gemini-2.5-flash",
		"gemini-2.5-flash-lite",
		"gemini-3-flash-preview",
		"gemini-3.1-flash-lite",
	];

	for (const id of expectedAudioFlashModelIds) {
		const model = models.find((m) => m.id === id);
		if (!model) {
			continue;
		}
		const providers = model.providers as readonly ProviderModelMapping[];
		const audioCapableProviders = providers.filter((p) => p.audio === true);
		const audioPricedProviders = providers.filter(
			(p) => p.inputAudioPrice !== undefined,
		);
		it(`marks every audio-priced provider on ${id} as audio: true`, () => {
			expect(audioCapableProviders.length).toBe(audioPricedProviders.length);
			expect(audioCapableProviders.length).toBeGreaterThan(0);
		});
	}

	const expectedAudioProModelIds = [
		"gemini-2.5-pro",
		"gemini-3-pro-preview",
		"gemini-3.1-pro-preview",
		"gemini-1.5-pro",
		"gemini-1.5-flash",
		"gemini-1.5-flash-8b",
		"gemini-2.0-flash-lite",
	];

	for (const id of expectedAudioProModelIds) {
		const model = models.find((m) => m.id === id);
		if (!model) {
			continue;
		}
		const providers = model.providers as readonly ProviderModelMapping[];
		const audioCapableProviders = providers.filter((p) => p.audio === true);
		it(`marks Pro/legacy audio-capable model ${id} on every provider`, () => {
			expect(audioCapableProviders.length).toBe(providers.length);
			expect(audioCapableProviders.length).toBeGreaterThan(0);
		});
	}

	it("does not flag image-only Gemini variants as audio-capable", () => {
		const imageOnlyIds = [
			"gemini-2.5-flash-image",
			"gemini-2.5-flash-image-preview",
			"gemini-3-pro-image-preview",
			"gemini-3.1-flash-image-preview",
		];
		for (const id of imageOnlyIds) {
			const model = models.find((m) => m.id === id);
			if (!model) {
				continue;
			}
			const providers = model.providers as readonly ProviderModelMapping[];
			const audioCapableProviders = providers.filter((p) => p.audio === true);
			expect(audioCapableProviders.length).toBe(0);
		}
	});
});
