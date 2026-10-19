import { describe, expect, it } from "vitest";

import { audioTabModels, initialAudioModels } from "./audio-models";

import type { ApiModel } from "@/lib/fetch-models";

const models = [
	{
		id: "tts-1",
		output: ["audio"],
		mappings: [
			{ providerId: "openai", speechGenerations: true, realtime: null },
		],
	},
	{
		id: "grok-voice-3-0",
		output: ["text", "audio"],
		mappings: [{ providerId: "xai", speechGenerations: null, realtime: true }],
	},
	{
		id: "gpt-4o",
		output: ["text"],
		mappings: [
			{ providerId: "openai", speechGenerations: null, realtime: null },
		],
	},
] as unknown as ApiModel[];

describe("audioTabModels", () => {
	it("lists speech models and leaves out realtime models that also output audio", () => {
		expect(audioTabModels(models).map((model) => model.id)).toEqual(["tts-1"]);
	});
});

describe("initialAudioModels", () => {
	const offered = [
		{ id: "tts-1" },
		{ id: "openai/tts-1" },
		{ id: "eleven-v3" },
	];

	it("keeps the first saved selection the picker offers", () => {
		expect(
			initialAudioModels(["eleven-v3,openai/tts-1", "tts-1"], offered),
		).toEqual(["eleven-v3", "openai/tts-1"]);
	});

	it("drops saved models the picker no longer offers", () => {
		expect(initialAudioModels(["grok-voice-3-0,eleven-v3"], offered)).toEqual([
			"eleven-v3",
		]);
	});

	it("falls through to the next saved selection, then the first offered model", () => {
		expect(
			initialAudioModels(["xai/grok-voice-3-0", "eleven-v3"], offered),
		).toEqual(["eleven-v3"]);
		expect(initialAudioModels(["grok-voice-3-0", null], offered)).toEqual([
			"tts-1",
		]);
	});

	it("selects nothing when the picker offers nothing", () => {
		expect(initialAudioModels(["tts-1"], [])).toEqual([]);
	});
});
