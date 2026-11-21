/**
 * Lyria music generation, served through /v1/audio/speech: Vertex `:predict`
 * (lyria-002) or the AI Studio Interactions API (Lyria 3).
 */

interface LyriaResponse {
	predictions?: Array<{ bytesBase64Encoded?: unknown; mimeType?: unknown }>;
	steps?: Array<{
		content?: Array<{ type?: unknown; data?: unknown; mime_type?: unknown }>;
	}>;
	usage?: { total_input_tokens?: unknown; total_output_tokens?: unknown };
}

export interface MusicAudio {
	data: string | undefined;
	mimeType: string | undefined;
	inputTokens: number | null;
	outputTokens: number | null;
}

export function buildMusicRequestBody(
	isGoogleVertex: boolean,
	upstreamModel: string,
	prompt: string,
): Record<string, unknown> {
	return isGoogleVertex
		? { instances: [{ prompt }], parameters: { sample_count: 1 } }
		: { model: upstreamModel, input: prompt };
}

function tokenCount(value: unknown): number | null {
	return typeof value === "number" ? value : null;
}

export function extractMusicAudio(body: unknown): MusicAudio {
	const json: LyriaResponse =
		body && typeof body === "object" ? (body as LyriaResponse) : {};

	const prediction = json.predictions?.find(
		(candidate) => typeof candidate.bytesBase64Encoded === "string",
	);
	if (prediction) {
		return {
			data: prediction.bytesBase64Encoded as string,
			mimeType:
				typeof prediction.mimeType === "string"
					? prediction.mimeType
					: "audio/wav",
			inputTokens: null,
			outputTokens: null,
		};
	}

	const audio = json.steps
		?.flatMap((step) => step.content ?? [])
		.find((part) => part.type === "audio" && typeof part.data === "string");
	return {
		data: typeof audio?.data === "string" ? audio.data : undefined,
		mimeType:
			typeof audio?.mime_type === "string" ? audio.mime_type : undefined,
		inputTokens: tokenCount(json.usage?.total_input_tokens),
		outputTokens: tokenCount(json.usage?.total_output_tokens),
	};
}
