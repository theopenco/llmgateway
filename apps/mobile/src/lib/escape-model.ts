import { createModelPreference } from "@/lib/model-preference";

export const {
	clear: clearEscapeModel,
	load: loadEscapeModel,
	save: saveEscapeModel,
	useModel: useEscapeModel,
} = createModelPreference("escape", "openai/gpt-5-mini");
