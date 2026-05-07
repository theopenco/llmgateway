export function extractFirstSseEventData(buffer: string): string | null {
	const normalizedBuffer = buffer.replace(/\r\n/g, "\n");
	const completeEvents = normalizedBuffer.split("\n\n");
	const completeEventCount = completeEvents.length - 1;

	for (let eventIndex = 0; eventIndex < completeEventCount; eventIndex++) {
		const eventChunk = completeEvents[eventIndex];
		if (!eventChunk) {
			continue;
		}

		const eventData = eventChunk
			.split("\n")
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).trimStart())
			.join("\n")
			.trim();

		if (eventData.length > 0) {
			return eventData;
		}
	}

	return null;
}
