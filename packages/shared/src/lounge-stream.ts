function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export interface GatewaySourceCitation {
	url: string;
	title?: string;
}

// The gateway surfaces web search results as OpenAI-style `url_citation`
// annotations, which the AI SDK provider does not forward as source parts
// when streaming — so they are captured here from the raw SSE side-channel.
export function extractUrlCitations(value: unknown): GatewaySourceCitation[] {
	if (!isRecord(value) || !Array.isArray(value.choices)) {
		return [];
	}

	const citations: GatewaySourceCitation[] = [];
	for (const choice of value.choices) {
		if (!isRecord(choice)) {
			continue;
		}
		for (const container of [choice.delta, choice.message]) {
			if (!isRecord(container) || !Array.isArray(container.annotations)) {
				continue;
			}
			for (const annotation of container.annotations) {
				if (
					!isRecord(annotation) ||
					annotation.type !== "url_citation" ||
					!isRecord(annotation.url_citation)
				) {
					continue;
				}
				const url =
					typeof annotation.url_citation.url === "string"
						? annotation.url_citation.url
						: undefined;
				if (url) {
					citations.push({
						url,
						title:
							typeof annotation.url_citation.title === "string"
								? annotation.url_citation.title
								: undefined,
					});
				}
			}
		}
	}

	return citations;
}

export function inspectGatewayStream(
	onEvent: (value: unknown) => void,
): TransformStream<Uint8Array, Uint8Array> {
	const decoder = new TextDecoder();
	let buffer = "";
	const parse = (events: string[]) => {
		for (const event of events) {
			const data = event
				.split(/\r?\n/)
				.filter((line) => line.startsWith("data:"))
				.map((line) => line.slice(5).trimStart())
				.join("\n");
			if (!data || data === "[DONE]") {
				continue;
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(data);
			} catch {
				// The provider still receives malformed events and handles their errors.
				continue;
			}
			onEvent(parsed);
		}
	};
	return new TransformStream({
		transform(chunk, controller) {
			buffer += decoder.decode(chunk, { stream: true });
			const events = buffer.split(/\r?\n\r?\n/);
			buffer = events.pop() ?? "";
			parse(events);
			controller.enqueue(chunk);
		},
		flush() {
			buffer += decoder.decode();
			if (buffer) {
				parse([buffer]);
			}
		},
	});
}

export function withSseKeepalive(
	body: ReadableStream<Uint8Array | string>,
	intervalMs: number,
): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	const reader = body.getReader();
	let keepaliveTimer: ReturnType<typeof setInterval> | undefined;

	return new ReadableStream<Uint8Array>({
		start(controller) {
			keepaliveTimer = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(": ping\n\n"));
				} catch {
					// Stream already closed, clean up.
					clearInterval(keepaliveTimer);
				}
			}, intervalMs);

			// Read upstream chunks in a loop and forward them.
			void (async () => {
				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done) {
							clearInterval(keepaliveTimer);
							controller.close();
							return;
						}
						controller.enqueue(
							typeof value === "string" ? encoder.encode(value) : value,
						);
					}
				} catch (err) {
					clearInterval(keepaliveTimer);
					controller.error(err);
				}
			})();
		},
		cancel() {
			clearInterval(keepaliveTimer);
			void reader.cancel();
		},
	});
}
