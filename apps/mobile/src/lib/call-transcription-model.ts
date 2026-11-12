import { createModelPreference } from "@/lib/model-preference";

export const {
	clear: clearCallTranscriptionModel,
	save: saveCallTranscriptionModel,
	useModel: useCallTranscriptionModel,
} = createModelPreference("call-transcription", "");
