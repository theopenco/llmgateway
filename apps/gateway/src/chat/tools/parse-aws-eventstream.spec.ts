import { describe, expect, it } from "vitest";

import {
	convertAwsEventStreamToSSE,
	parseAwsEventStream,
} from "./parse-aws-eventstream.js";

const textEncoder = new TextEncoder();

function encodeAwsEventStreamHeader(name: string, value: string): Uint8Array {
	const nameBytes = textEncoder.encode(name);
	const valueBytes = textEncoder.encode(value);
	const header = new Uint8Array(
		1 + nameBytes.length + 1 + 2 + valueBytes.length,
	);
	let offset = 0;
	header[offset++] = nameBytes.length;
	header.set(nameBytes, offset);
	offset += nameBytes.length;
	header[offset++] = 7;
	new DataView(header.buffer).setUint16(offset, valueBytes.length, false);
	offset += 2;
	header.set(valueBytes, offset);
	return header;
}

function encodeAwsEventStreamMessage(
	headers: Record<string, string>,
	payload: string,
): Uint8Array {
	const encodedHeaders = Object.entries(headers).map(([name, value]) =>
		encodeAwsEventStreamHeader(name, value),
	);
	const headersLength = encodedHeaders.reduce(
		(total, header) => total + header.length,
		0,
	);
	const payloadBytes = textEncoder.encode(payload);
	const totalLength = 12 + headersLength + payloadBytes.length + 4;
	const message = new Uint8Array(totalLength);
	const view = new DataView(message.buffer);
	view.setUint32(0, totalLength, false);
	view.setUint32(4, headersLength, false);
	view.setUint32(8, 0, false);
	let offset = 12;
	for (const header of encodedHeaders) {
		message.set(header, offset);
		offset += header.length;
	}
	message.set(payloadBytes, offset);
	view.setUint32(totalLength - 4, 0, false);
	return message;
}

describe("parseAwsEventStream", () => {
	it("tracks the full encoded message length", () => {
		const message = encodeAwsEventStreamMessage(
			{
				":message-type": "event",
				":event-type": "messageStop",
				":content-type": "application/json",
			},
			JSON.stringify({ stopReason: "end_turn" }),
		);

		const parsed = parseAwsEventStream(message);

		expect(parsed).toHaveLength(1);
		expect(parsed[0]?.totalLength).toBe(message.length);
		expect(parsed[0]?.headers[":event-type"]).toBe("messageStop");
	});
});

describe("convertAwsEventStreamToSSE", () => {
	it("preserves Bedrock exception frames when the payload is not JSON", () => {
		const message = encodeAwsEventStreamMessage(
			{
				":message-type": "exception",
				":event-type": "serviceUnavailableException",
				":content-type": "text/plain",
			},
			"The service is temporarily unavailable.",
		);

		const result = convertAwsEventStreamToSSE(message);

		expect(result.bytesConsumed).toBe(message.length);
		expect(result.sse).toContain(
			'"__aws_event_type":"serviceUnavailableException"',
		);
		expect(result.sse).toContain(
			'"message":"The service is temporarily unavailable."',
		);
	});
});
