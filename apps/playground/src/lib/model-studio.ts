import type { ApiModel } from "@/lib/fetch-models";

/** Outputs that no chat surface or studio can serve. */
const NON_CHAT_OUTPUTS = [
	"embedding",
	"rerank",
	"decision",
	"search",
	"transcription",
];

export interface ModelStudio {
	/** Studio name, e.g. "Video Studio". */
	name: string;
	/** What the model is, completing "<model> is …". */
	kind: string;
	href: string;
}

/**
 * Whether the chat model picker lists the model. Models served by a studio
 * stay listed and open it on selection (getModelStudio).
 */
export function isChatPickerModel(model: Pick<ApiModel, "output">): boolean {
	return !NON_CHAT_OUTPUTS.some((output) => model.output?.includes(output));
}

/** Group chat is text-only and cannot hand a model off to a studio. */
export function isGroupChatModel(
	model: Pick<ApiModel, "id" | "output" | "mappings">,
): boolean {
	return (
		isChatPickerModel(model) &&
		!model.output?.includes("image") &&
		getModelStudio(model) === null
	);
}

/**
 * The studio that serves a model the chat cannot, or null for chat models.
 */
export function getModelStudio(
	model: Pick<ApiModel, "id" | "output" | "mappings">,
): ModelStudio | null {
	const id = encodeURIComponent(model.id);
	if (model.output?.includes("video")) {
		return {
			name: "Video Studio",
			kind: "a video generation model",
			href: `/video?model=${id}`,
		};
	}
	const servedOnlyBy = (
		capability: "realtime" | "realtimeTranscription",
	): boolean =>
		model.mappings.length > 0 &&
		model.mappings.every((mapping) => mapping[capability] === true);
	if (servedOnlyBy("realtime")) {
		return {
			name: "Voice Calls",
			kind: "a realtime voice model",
			href: `/realtime?model=${id}`,
		};
	}
	if (servedOnlyBy("realtimeTranscription")) {
		return {
			name: "Voice Calls",
			kind: "a realtime transcription model",
			href: `/realtime?mode=transcribe&model=${id}`,
		};
	}
	if (model.output?.includes("audio")) {
		return {
			name: "Audio Studio",
			kind: "a speech generation model",
			href: `/audio?model=${id}`,
		};
	}
	return null;
}
