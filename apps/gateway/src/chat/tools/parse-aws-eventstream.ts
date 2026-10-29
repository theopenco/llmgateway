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

/**
 * A frame that breaks the EventStream framing rules can never become valid by
 * waiting for more bytes, unlike a merely truncated one. Callers that keep an
 * incremental buffer must abort instead of retrying, or they accumulate the
 * rest of the response behind a frame that will never be consumed.
 */
export interface EventStreamParseResult {
	messages: EventStreamMessage[];
	invalid: boolean;
	/** Bytes covered by `messages`; the rest is an incomplete or rejected frame. */
	bytesConsumed: number;
}

/**
 * Fixed per-message overhead: 8-byte prelude (total length + headers length) +
 * 4-byte prelude CRC + 4-byte message CRC. A message with zero headers and an
 * empty payload is exactly this many bytes, so no valid total length is smaller.
 */
const MIN_MESSAGE_LENGTH = 16;

export function parseAwsEventStreamFrames(
	buffer: Uint8Array,
): EventStreamParseResult {
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

		// Reject a corrupt or truncated prelude before trusting its length.
		// A total length below the fixed overhead cannot describe a real frame,
		// and totalLength === 0 would advance offset by 0 below and loop
		// forever, pushing empty messages until the process runs out of memory.
		if (totalLength < MIN_MESSAGE_LENGTH) {
			return { messages, invalid: true, bytesConsumed: offset };
		}

		// Headers must fit within the message alongside the fixed overhead;
		// an oversized headers length is corrupt and would read past the frame.
		if (headersLength > totalLength - MIN_MESSAGE_LENGTH) {
			return { messages, invalid: true, bytesConsumed: offset };
		}

		// Check if we have the full message
		if (offset + totalLength > buffer.length) {
			break;
		}

		// Skip prelude CRC (4 bytes)
		let headerOffset = offset + 12;

		// Parse headers
		const headers: Record<string, string> = {};
		const headersEnd = headerOffset + headersLength;

		// Reject fields that cross the header boundary before emitting payloads.
		while (headerOffset < headersEnd) {
			// Read header name length (1 byte)
			const nameLength = buffer[headerOffset];
			headerOffset += 1;

			// Name plus the 1-byte value type must fit in the header section
			if (headerOffset + nameLength + 1 > headersEnd) {
				return { messages, invalid: true, bytesConsumed: offset };
			}

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
				if (headerOffset + 2 > headersEnd) {
					return { messages, invalid: true, bytesConsumed: offset };
				}

				// Read value length (2 bytes, big-endian)
				const valueLength = new DataView(
					buffer.buffer,
					buffer.byteOffset + headerOffset,
					2,
				).getUint16(0, false);
				headerOffset += 2;

				if (headerOffset + valueLength > headersEnd) {
					return { messages, invalid: true, bytesConsumed: offset };
				}

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

	return { messages, invalid: false, bytesConsumed: offset };
}

export function parseAwsEventStream(buffer: Uint8Array): EventStreamMessage[] {
	return parseAwsEventStreamFrames(buffer).messages;
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

export function convertAwsEventStreamToSSE(buffer: Uint8Array): {
	sse: string;
	bytesConsumed: number;
	invalid: boolean;
} {
	const { messages, invalid, bytesConsumed } =
		parseAwsEventStreamFrames(buffer);

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
		} catch {
			// Skip invalid JSON. The frame is still consumed: its framing is
			// sound, so a following frame must still be processed.
		}
	}

	return {
		sse: sseEvents.join(""),
		bytesConsumed,
		invalid,
	};
}
