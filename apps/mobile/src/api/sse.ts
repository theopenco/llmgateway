export interface CompletionDelta {
	content: string;
	reasoning: string;
}

export class SSEDecoder {
	private buffer = "";
	public push(chunk: string): string[] {
		this.buffer += chunk;
		const frames = this.buffer.split(/\r?\n\r?\n/);
		this.buffer = frames.pop() ?? "";
		return frames.flatMap((frame) => {
			const lines = frame
				.split(/\r?\n/)
				.filter((line) => line.startsWith("data:"))
				.map((line) => line.slice(5).replace(/^ /, ""));
			return lines.length ? [lines.join("\n")] : [];
		});
	}
}

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}
export function parseDelta(payload: string): CompletionDelta | null {
	if (payload === "[DONE]") {
		return null;
	}
	const data: unknown = JSON.parse(payload);
	if (!record(data)) {
		throw new Error("Invalid response from the model.");
	}
	if (data.error) {
		throw new Error(
			record(data.error) && typeof data.error.message === "string"
				? data.error.message
				: "The model could not complete this response.",
		);
	}
	const choice = Array.isArray(data.choices) ? data.choices[0] : undefined;
	const delta = record(choice) && record(choice.delta) ? choice.delta : {};
	return {
		content: typeof delta.content === "string" ? delta.content : "",
		reasoning:
			typeof delta.reasoning_content === "string"
				? delta.reasoning_content
				: "",
	};
}
