/**
 * Parses AWS Event Stream binary format
 * Format: https://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectSELECTContent.html#RESTObjectSELECTContent-responses
 *
 * Each message:
 * - 4 bytes: total message length (big-endian uint32)
 * - 4 bytes: headers length (big-endian uint32)
 * - 4 bytes: prelude CRC (big-endian uint32)
 * - N bytes: headers (key-value pairs)
 * - M bytes: payload
 * - 4 bytes: message CRC (big-endian uint32)
 */

interface EventStreamMessage {
	headers: Record<string, string>;
	payload: Uint8Array;
}

export function parseAwsEventStream(buffer: Uint8Array): EventStreamMessage[] {
	const messages: EventStreamMessage[] = [];
	let offset = 0;

	while (offset < buffer.length) {
		// Need at least 12 bytes for prelude
		if (offset + 12 > buffer.length) {
			break;
		}

		// Read prelude
		const totalLength = new DataView(
			buffer.buffer,
			buffer.byteOffset + offset,
			4,
		).getUint32(0, false);
		const headersLength = new DataView(
			buffer.buffer,
			buffer.byteOffset + offset + 4,
			4,
		).getUint32(0, false);

		// Check if we have the full message
		if (offset + totalLength > buffer.length) {
			break;
		}

		// Skip prelude CRC (4 bytes)
		let headerOffset = offset + 12;

		// Parse headers
		const headers: Record<string, string> = {};
		const headersEnd = headerOffset + headersLength;

		while (headerOffset < headersEnd) {
			// Read header name length (1 byte)
			const nameLength = buffer[headerOffset];
			headerOffset += 1;

			// Read header name
			const name = new TextDecoder().decode(
				buffer.slice(headerOffset, headerOffset + nameLength),
			);
			headerOffset += nameLength;

			// Read header value type (1 byte) - we expect 7 for string
			const valueType = buffer[headerOffset];
			headerOffset += 1;

			if (valueType === 7) {
				// String value
				// Read value length (2 bytes, big-endian)
				const valueLength = new DataView(
					buffer.buffer,
					buffer.byteOffset + headerOffset,
					2,
				).getUint16(0, false);
				headerOffset += 2;

				// Read value
				const value = new TextDecoder().decode(
					buffer.slice(headerOffset, headerOffset + valueLength),
				);
				headerOffset += valueLength;

				headers[name] = value;
			} else {
				// Other value types not supported yet
				break;
			}
		}

		// Extract payload
		const payloadStart = offset + 12 + headersLength;
		const payloadEnd = offset + totalLength - 4; // Exclude message CRC
		const payload = buffer.slice(payloadStart, payloadEnd);

		messages.push({ headers, payload });

		// Move to next message
		offset += totalLength;
	}

	return messages;
}

export function parseAwsEventStreamJson(buffer: Uint8Array): any[] {
	const messages = parseAwsEventStream(buffer);
	return messages
		.map((msg) => {
			try {
				const json = JSON.parse(new TextDecoder().decode(msg.payload));
				return {
					...json,
					__event_type: msg.headers[":event-type"],
				};
			} catch {
				return null;
			}
		})
		.filter((msg) => msg !== null);
}

/**
 * Converts AWS EventStream binary data to SSE text format for unified processing
 * Returns the converted string and the number of bytes consumed from the buffer
 */
export function convertAwsEventStreamToSSE(buffer: Uint8Array): {
	sse: string;
	bytesConsumed: number;
} {
	const messages = parseAwsEventStream(buffer);

	if (messages.length === 0) {
		return { sse: "", bytesConsumed: 0 };
	}

	// Calculate total bytes consumed
	let bytesConsumed = 0;
	const sseEvents: string[] = [];

	for (const msg of messages) {
		try {
			const json = JSON.parse(new TextDecoder().decode(msg.payload));

			// Add event type to the JSON payload for easier processing
			const eventType = msg.headers[":event-type"];
			const enrichedJson = {
				...json,
				__aws_event_type: eventType,
			};

			// Convert to SSE format: "data: {...}\n\n"
			sseEvents.push(`data: ${JSON.stringify(enrichedJson)}\n\n`);

			// Calculate message size (total length is in first 4 bytes of each message)
			const messageStart = bytesConsumed;
			if (messageStart + 4 <= buffer.length) {
				const totalLength = new DataView(
					buffer.buffer,
					buffer.byteOffset + messageStart,
					4,
				).getUint32(0, false);
				bytesConsumed += totalLength;
			}
		} catch {
			// Skip invalid JSON
		}
	}

	return {
		sse: sseEvents.join(""),
		bytesConsumed,
	};
}
