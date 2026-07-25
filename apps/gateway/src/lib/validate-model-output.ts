import { HTTPException } from "hono/http-exception";

import type { ModelDefinition } from "@llmgateway/models";

/**
 * The kinds of output a model can produce. Each kind maps 1:1 to the gateway
 * endpoint that serves it, so the requested model's declared output is the
 * single signal used to gate every route.
 */
export type ModelOutput =
	| "text"
	| "image"
	| "video"
	| "embedding"
	| "audio"
	| "ocr"
	| "transcription";

const OUTPUT_ENDPOINT: Record<
	ModelOutput,
	{ label: string; endpoint: string }
> = {
	text: { label: "a chat", endpoint: "/v1/chat/completions" },
	image: { label: "an image generation", endpoint: "/v1/images/generations" },
	video: { label: "a video generation", endpoint: "/v1/videos" },
	embedding: { label: "an embeddings", endpoint: "/v1/embeddings" },
	audio: { label: "a speech", endpoint: "/v1/audio/speech" },
	ocr: { label: "an OCR", endpoint: "/v1/ocr" },
	transcription: {
		label: "a transcription",
		endpoint: "/v1/audio/transcriptions",
	},
};

/**
 * The model's declared output capabilities. Models that don't declare an
 * `output` are text models (the default), so the absence of the field reads as
 * `["text"]`.
 */
export function getModelOutputs(modelInfo: ModelDefinition): ModelOutput[] {
	return modelInfo.output && modelInfo.output.length > 0
		? modelInfo.output
		: ["text"];
}

/**
 * Reject (400) a model whose declared output capabilities don't intersect the
 * output types the calling endpoint serves. "auto" and "custom" are resolved
 * dynamically, so they always pass. The error points the caller at the endpoint
 * that matches the model's primary output (e.g. an embeddings model requested on
 * /v1/chat/completions is told to use /v1/embeddings instead).
 */
export function validateModelOutput(
	modelInfo: ModelDefinition,
	requestedModel: string,
	accepted: ModelOutput[],
): void {
	if (requestedModel === "auto" || requestedModel === "custom") {
		return;
	}

	const outputs = getModelOutputs(modelInfo);
	if (outputs.some((output) => accepted.includes(output))) {
		return;
	}

	const primary = OUTPUT_ENDPOINT[outputs[0]];
	const wanted = OUTPUT_ENDPOINT[accepted[0]];

	throw new HTTPException(400, {
		message: `Model ${requestedModel} is ${primary.label} model and cannot be used with ${wanted.endpoint}. Use the ${primary.endpoint} endpoint instead.`,
	});
}
