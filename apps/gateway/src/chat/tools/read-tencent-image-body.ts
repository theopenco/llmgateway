/**
 * TokenHub's Hy Image API documents a single JSON body but describes its
 * frames as SSE deltas, with the image in the last frame. Accept both: a
 * JSON object is returned as-is; for an SSE body the frame carrying the image
 * (or the error) wins, falling back to the last frame.
 */
interface TencentImageFrame {
	choices?: Array<{ delta?: { image?: { url?: unknown } } }>;
	error?: unknown;
	usage?: unknown;
	tokenhub_usage?: unknown;
}

export function readTencentImageBody(text: string): unknown {
	const trimmed = text.trim();
	if (trimmed.startsWith("{")) {
		return JSON.parse(trimmed);
	}

	let last: TencentImageFrame | null = null;
	let result: TencentImageFrame | null = null;
	for (const rawLine of trimmed.split("\n")) {
		const line = rawLine.trim();
		if (!line.startsWith("data:")) {
			continue;
		}
		const data = line.slice(5).trim();
		if (!data || data === "[DONE]") {
			continue;
		}
		const frame = JSON.parse(data) as TencentImageFrame;
		last = frame;
		if (frame.choices?.[0]?.delta?.image?.url || frame.error) {
			result = frame;
		}
	}

	const frame = result ?? last;
	if (!frame) {
		throw new SyntaxError("Tencent image response contained no JSON frames");
	}
	return {
		...frame,
		usage: frame.usage ?? last?.usage,
		tokenhub_usage: frame.tokenhub_usage ?? last?.tokenhub_usage,
	};
}
