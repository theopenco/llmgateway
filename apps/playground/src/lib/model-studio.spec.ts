import { describe, expect, it } from "vitest";

import {
	getModelStudio,
	isChatPickerModel,
	isGroupChatModel,
} from "./model-studio";

import type { ApiModel, ApiModelProviderMapping } from "@/lib/fetch-models";

function model(
	id: string,
	output: string[],
	mappings: Array<Partial<ApiModelProviderMapping>> = [{}],
): Pick<ApiModel, "id" | "output" | "mappings"> {
	return {
		id,
		output,
		mappings: mappings as ApiModelProviderMapping[],
	};
}

describe("getModelStudio", () => {
	it.each([
		[model("veo", ["video"]), "Video Studio", "/video?model=veo"],
		[
			model("gpt-realtime", ["text", "audio"], [{ realtime: true }]),
			"Voice Calls",
			"/realtime?model=gpt-realtime",
		],
		[
			model("scribe-v3-live", ["text"], [{ realtimeTranscription: true }]),
			"Voice Calls",
			"/realtime?mode=transcribe&model=scribe-v3-live",
		],
		[
			model("eleven-v3", ["audio"], [{ speechGenerations: true }]),
			"Audio Studio",
			"/audio?model=eleven-v3",
		],
	])("routes %j to %s", (input, name, href) => {
		expect(getModelStudio(input)).toMatchObject({ name, href });
	});

	it("keeps chat models in chat", () => {
		expect(getModelStudio(model("gpt-5", ["text"]))).toBeNull();
		expect(
			getModelStudio(
				model("mixed", ["text"], [{ realtimeTranscription: true }, {}]),
			),
		).toBeNull();
	});
});

describe("model pickers", () => {
	it("hides models no chat surface can serve", () => {
		expect(isChatPickerModel(model("scribe-v3", ["transcription"]))).toBe(
			false,
		);
		expect(isChatPickerModel(model("embed", ["embedding"]))).toBe(false);
		expect(isChatPickerModel(model("veo", ["video"]))).toBe(true);
	});

	it("keeps group chat to text chat models", () => {
		expect(isGroupChatModel(model("gpt-5", ["text"]))).toBe(true);
		expect(
			isGroupChatModel(
				model("gpt-transcribe", ["text"], [{ realtimeTranscription: true }]),
			),
		).toBe(false);
		expect(isGroupChatModel(model("img", ["text", "image"]))).toBe(false);
	});
});
