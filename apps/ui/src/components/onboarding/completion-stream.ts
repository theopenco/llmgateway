export interface CompletionStreamResult {
	content: string;
	model: string | null;
	/**
	 * The gateway reports failures that happen after the response has started as
	 * an SSE `error` event on an otherwise 200 response, so a stream can carry
	 * both partial content and an error.
	 */
	error: string | null;
}

export function extractErrorMessage(payload: unknown): string {
	if (typeof payload === "string") {
		return payload;
	}
	if (payload && typeof payload === "object") {
		const { error, message } = payload as {
			error?: unknown;
			message?: unknown;
		};
		if (typeof error === "string") {
			return error;
		}
		if (error && typeof error === "object") {
			const nested = (error as { message?: unknown }).message;
			if (typeof nested === "string") {
				return nested;
			}
		}
		if (typeof message === "string") {
			return message;
		}
	}
	return "Request failed";
}

/**
 * Read an OpenAI-style SSE completion stream, reporting content as it arrives.
 */
export async function readCompletionStream(
	stream: ReadableStream<Uint8Array>,
	onContent: (content: string) => void,
): Promise<CompletionStreamResult> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let content = "";
	let model: string | null = null;
	let error: string | null = null;
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}

		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || !trimmed.startsWith("data: ")) {
				continue;
			}

			const data = trimmed.slice(6);
			if (data === "[DONE]") {
				continue;
			}

			try {
				const parsed = JSON.parse(data);
				if (parsed.error) {
					error = extractErrorMessage(parsed);
				}
				const delta = parsed.choices?.[0]?.delta?.content;
				if (delta) {
					content += delta;
					onContent(content);
				}
				if (parsed.model) {
					model = parsed.model;
				}
			} catch {
				// Skip malformed chunks
			}
		}
	}

	return { content, model, error };
}
