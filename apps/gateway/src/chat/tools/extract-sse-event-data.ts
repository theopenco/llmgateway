/**
 * Returns the non-empty `data:` payloads of every complete SSE event in the
 * buffer, in order. Comments, keepalives without data, and a trailing
 * incomplete event are skipped.
 */
export function extractSseEventData(buffer: string): string[] {
	const completeEvents = buffer.replace(/\r\n|\r/g, "\n").split("\n\n");
	completeEvents.pop();

	const payloads: string[] = [];
	for (const eventChunk of completeEvents) {
		const eventData = eventChunk
			.split("\n")
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).trimStart())
			.join("\n")
			.trim();

		if (eventData.length > 0) {
			payloads.push(eventData);
		}
	}

	return payloads;
}
