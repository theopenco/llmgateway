/**
 * Collapses an OpenAI / Azure image-generation SSE stream into the same
 * non-streaming JSON shape the providers return when stream=false.
 *
 * The gateway forces stream=true&partial_images=1 upstream for openai/azure
 * gpt-image-* even when the client requested non-streaming, so that the
 * connection stays alive past Azure's 122s synchronous wall and we can rely
 * on AI_STREAMING_TIMEOUT_MS instead of AI_TIMEOUT_MS. The forced partial is
 * discarded here; only the final completed event is used.
 *
 * Two endpoints, two event-name families — both shapes are otherwise identical:
 *   /v1/images/generations → image_generation.partial_image / image_generation.completed
 *   /v1/images/edits       → image_edit.partial_image       / image_edit.completed
 *
 * Output JSON shape (matches parseProviderResponse's openai/azure image branch):
 *   { created, data: [{ b64_json }], usage: {...}, size?, quality?, output_format? }
 */

interface CollapseResult {
	json: Record<string, unknown>;
}

interface CollapseError {
	error: {
		message: string;
		code?: string;
		type?: string;
	};
}

export type CollapseImageGenSseResult = CollapseResult | CollapseError;

export function collapseImageGenSse(text: string): CollapseImageGenSseResult {
	let completed: Record<string, unknown> | null = null;
	let errorEvent: Record<string, unknown> | null = null;

	for (const rawLine of text.split("\n")) {
		const line = rawLine.trimEnd();
		if (!line.startsWith("data:")) {
			continue;
		}
		const payload = line.slice(5).trimStart();
		if (!payload || payload === "[DONE]") {
			continue;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(payload);
		} catch {
			continue;
		}
		if (!parsed || typeof parsed !== "object") {
			continue;
		}
		const obj = parsed as Record<string, unknown>;
		const type = typeof obj.type === "string" ? obj.type : undefined;

		if (
			type === "image_generation.completed" ||
			type === "image_edit.completed"
		) {
			completed = obj;
			break;
		}
		if (type === "error" || obj.error) {
			errorEvent = obj;
		}
	}

	if (errorEvent && !completed) {
		const errObj =
			(errorEvent.error as Record<string, unknown> | undefined) ?? errorEvent;
		const message =
			typeof errObj.message === "string"
				? errObj.message
				: "Upstream image generation stream error";
		return {
			error: {
				message,
				code: typeof errObj.code === "string" ? errObj.code : undefined,
				type: typeof errObj.type === "string" ? errObj.type : undefined,
			},
		};
	}

	if (!completed) {
		return {
			error: {
				message: "Upstream image stream ended without a completed event",
				code: "incomplete_stream",
				type: "upstream_error",
			},
		};
	}

	const b64 =
		typeof completed.b64_json === "string" ? completed.b64_json : undefined;
	if (!b64) {
		return {
			error: {
				message: "Upstream completed event missing b64_json field",
				code: "missing_image",
				type: "upstream_error",
			},
		};
	}

	const dataItem: Record<string, unknown> = { b64_json: b64 };
	if (typeof completed.revised_prompt === "string") {
		dataItem.revised_prompt = completed.revised_prompt;
	}

	const json: Record<string, unknown> = {
		created:
			typeof completed.created_at === "number"
				? completed.created_at
				: Math.floor(Date.now() / 1000),
		data: [dataItem],
	};
	if (completed.usage && typeof completed.usage === "object") {
		json.usage = completed.usage;
	}
	if (typeof completed.size === "string") {
		json.size = completed.size;
	}
	if (typeof completed.quality === "string") {
		json.quality = completed.quality;
	}
	if (typeof completed.output_format === "string") {
		json.output_format = completed.output_format;
	}
	if (typeof completed.background === "string") {
		json.background = completed.background;
	}

	return { json };
}
