import { gatewayClient } from "@/api/gateway";
import { blobBase64 } from "@/lib/blob";

import { getModelAudioConfig } from "@llmgateway/shared/audio-generation-config";

import type { paths } from "@/lib/api/v1";
import type { AudioFormat } from "@llmgateway/shared/audio-generation-config";

export type AudioHistoryItem =
	paths["/playground/audio-history"]["get"]["responses"][200]["content"]["application/json"]["items"][number];
export type AudioResult = AudioHistoryItem["models"][number];
export type AudioGeneration = NonNullable<
	paths["/playground/audio-history"]["post"]["requestBody"]
>["content"]["application/json"];
export interface AudioSettings {
	voice: string;
	format: AudioFormat;
	speed: number;
	instructions: string;
}
export function defaultAudioSettings(model: string): AudioSettings {
	const config = getModelAudioConfig(model);
	return {
		voice: config.defaultVoice,
		format: config.defaultFormat,
		speed: 1,
		instructions: "",
	};
}
export async function generateSpeech(
	projectId: string,
	model: string,
	input: string,
	settings: AudioSettings,
): Promise<AudioResult> {
	try {
		const config = getModelAudioConfig(model);
		const format = config.availableFormats.includes(settings.format)
			? settings.format
			: config.defaultFormat;
		const gateway = await gatewayClient(projectId, model);
		const { data, response } = await gateway.POST("/v1/audio/speech", {
			parseAs: "blob",
			body: {
				model,
				input: input.trim(),
				voice: config.voices.includes(settings.voice)
					? settings.voice
					: config.defaultVoice,
				response_format: format,
				...(config.supportsSpeed &&
				config.availableSpeeds.includes(settings.speed)
					? { speed: settings.speed }
					: {}),
				...(config.supportsInstructions && settings.instructions.trim()
					? { instructions: settings.instructions.trim() }
					: {}),
			},
		});
		if (!data?.size) {
			throw new Error("The model returned no audio.");
		}
		return {
			modelId: model,
			modelName: model,
			audio: {
				base64: await blobBase64(data),
				mediaType:
					response.headers.get("content-type")?.split(";")[0] ?? "audio/mpeg",
			},
		};
	} catch (error) {
		return {
			modelId: model,
			modelName: model,
			audio: null,
			error:
				error instanceof Error ? error.message : "Speech generation failed.",
		};
	}
}
