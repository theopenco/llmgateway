import { describe, expect, it } from "vitest";

import { convertAwsEventStreamToSSE } from "./parse-aws-eventstream.js";

function frame(payload: string): Uint8Array {
	const bytes = new TextEncoder().encode(payload);
	const totalLength = 12 + bytes.length + 4;
	const result = new Uint8Array(totalLength);
	new DataView(result.buffer).setUint32(0, totalLength, false);
	result.set(bytes, 12);
	return result;
}

describe("convertAwsEventStreamToSSE", () => {
	it("consumes invalid JSON frames so a following valid frame is processed", () => {
		const invalid = frame("{invalid");
		const valid = frame('{"completion":"ok"}');
		const buffer = new Uint8Array(invalid.length + valid.length);
		buffer.set(invalid);
		buffer.set(valid, invalid.length);

		const result = convertAwsEventStreamToSSE(buffer);

		expect(result.sse).toContain('"completion":"ok"');
		expect(result.bytesConsumed).toBe(buffer.length);
	});

	it("retains incomplete frames", () => {
		const complete = frame('{"completion":"ok"}');
		const incomplete = complete.slice(0, complete.length - 1);
		const buffer = new Uint8Array(complete.length + incomplete.length);
		buffer.set(complete);
		buffer.set(incomplete, complete.length);

		expect(convertAwsEventStreamToSSE(buffer)).toEqual({
			sse: 'data: {"completion":"ok"}\n\n',
			bytesConsumed: complete.length,
		});
	});
});
