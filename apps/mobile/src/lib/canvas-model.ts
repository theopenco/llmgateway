import { createModelPreference } from "@/lib/model-preference";

export const {
	clear: clearCanvasModel,
	load: loadCanvasModel,
	save: saveCanvasModel,
	useModel: useCanvasModel,
} = createModelPreference("canvas", "auto");
