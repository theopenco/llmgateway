import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
	convertAwsEventStreamToSSE,
	parseAwsEventStream,
	parseAwsEventStreamFrames,
} from "./parse-aws-eventstream.js";

function frame(payload: string): Uint8Array {
	const bytes = new TextEncoder().encode(payload);
	const totalLength = 12 + bytes.length + 4;
	const result = new Uint8Array(totalLength);
	new DataView(result.buffer).setUint32(0, totalLength, false);
	result.set(bytes, 12);
	return result;
}

/**
 * Runs parseAwsEventStream on a payload in a separate process capped by a hard
 * timeout and a small heap. A malformed prelude whose total length is below the
 * 16-byte minimum (e.g. all zeros) would otherwise never advance the read
 * offset, spinning forever while pushing empty messages until the process runs
 * out of memory. A synchronous infinite loop cannot be interrupted by the test
 * runner, so it must be contained here instead of called in-process.
 */
function parseInChild(bytes: number[]): {
	terminated: boolean;
	status: number | null;
	timedOut: boolean;
} {
	const moduleUrl = new URL("./parse-aws-eventstream.ts", import.meta.url).href;
	const script = `
		const { parseAwsEventStream } = await import(${JSON.stringify(moduleUrl)});
		parseAwsEventStream(new Uint8Array(${JSON.stringify(bytes)}));
		process.stdout.write("TERMINATED");
	`;
	const result = spawnSync(
		process.execPath,
		["--max-old-space-size=128", "--input-type=module", "-e", script],
		{ timeout: 5000, encoding: "utf8" },
	);
	return {
		terminated: result.stdout === "TERMINATED",
		status: result.status,
		timedOut:
			(result.error as NodeJS.ErrnoException | undefined)?.code ===
				"ETIMEDOUT" || result.signal === "SIGTERM",
	};
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
			invalid: false,
		});
	});

	it("reports a structurally impossible frame as invalid, not incomplete", () => {
		const valid = frame('{"completion":"ok"}');
		const corrupt = new Uint8Array(16); // totalLength 0
		const buffer = new Uint8Array(valid.length + corrupt.length);
		buffer.set(valid);
		buffer.set(corrupt, valid.length);

		// The valid prefix is still delivered and consumed; the caller must abort
		// rather than wait for bytes that can never make the next frame parse.
		expect(convertAwsEventStreamToSSE(buffer)).toEqual({
			sse: 'data: {"completion":"ok"}\n\n',
			bytesConsumed: valid.length,
			invalid: true,
		});
	});
});

describe("parseAwsEventStream malformed input", () => {
	it("terminates on a zero-length prelude instead of looping forever", () => {
		// 16 zero bytes: >= the 12-byte prelude, so the length guards run, but
		// the encoded total length is 0. Without a minimum-length check the read
		// offset never advances and the loop is infinite.
		const result = parseInChild(new Array(16).fill(0));

		expect(result.timedOut).toBe(false);
		expect(result.terminated).toBe(true);
		expect(result.status).toBe(0);
	});

	it("rejects a headers length larger than the frame", () => {
		// Valid total length (16) but a headers length of 0xffffffff, which
		// cannot fit inside the message. Without the guard the frame is emitted
		// as a bogus empty message and the header section runs into the payload.
		const buffer = new Uint8Array(16);
		const view = new DataView(buffer.buffer);
		view.setUint32(0, 16, false); // total length
		view.setUint32(4, 0xffffffff, false); // headers length

		expect(() => parseAwsEventStream(buffer)).not.toThrow();
		expect(parseAwsEventStream(buffer)).toEqual([]);
		expect(parseAwsEventStreamFrames(buffer).invalid).toBe(true);
	});

	it("distinguishes a truncated frame from an invalid one", () => {
		const complete = frame('{"completion":"ok"}');
		const truncated = complete.slice(0, complete.length - 1);

		expect(parseAwsEventStreamFrames(truncated)).toEqual({
			messages: [],
			invalid: false,
			bytesConsumed: 0,
		});
		expect(parseAwsEventStreamFrames(new Uint8Array(16)).invalid).toBe(true);
	});

	it("leaves large incomplete frames to the caller's buffer limit", () => {
		const buffer = new Uint8Array(16);
		new DataView(buffer.buffer).setUint32(0, 0xffffffff, false);

		expect(parseAwsEventStreamFrames(buffer)).toEqual({
			messages: [],
			invalid: false,
			bytesConsumed: 0,
		});
	});

	it("stops header parsing when a header field overruns the header section", () => {
		// totalLength 18, headersLength 2. The single header declares a 3-byte
		// name, which overruns the 2-byte header section; an unchecked parser
		// then reads value type 7 from the CRC and a 2-byte value length past
		// the end of the buffer, throwing a RangeError.
		const buffer = new Uint8Array(18);
		const view = new DataView(buffer.buffer);
		view.setUint32(0, 18, false); // total length
		view.setUint32(4, 2, false); // headers length
		buffer[12] = 3; // header name length
		buffer[16] = 7; // would be read as a string value type

		expect(() => parseAwsEventStream(buffer)).not.toThrow();
		expect(parseAwsEventStreamFrames(buffer)).toEqual({
			messages: [],
			invalid: true,
			bytesConsumed: 0,
		});
	});

	it("still parses well-formed string headers", () => {
		const encoder = new TextEncoder();
		const name = encoder.encode(":event-type");
		const value = encoder.encode("chunk");
		const payload = encoder.encode('{"completion":"ok"}');
		const headersLength = 1 + name.length + 1 + 2 + value.length;
		const totalLength = 12 + headersLength + payload.length + 4;
		const buffer = new Uint8Array(totalLength);
		const view = new DataView(buffer.buffer);
		view.setUint32(0, totalLength, false);
		view.setUint32(4, headersLength, false);
		let offset = 12;
		buffer[offset++] = name.length;
		buffer.set(name, offset);
		offset += name.length;
		buffer[offset++] = 7;
		view.setUint16(offset, value.length, false);
		offset += 2;
		buffer.set(value, offset);
		offset += value.length;
		buffer.set(payload, offset);

		expect(convertAwsEventStreamToSSE(buffer)).toEqual({
			sse: 'data: {"completion":"ok","__aws_event_type":"chunk"}\n\n',
			bytesConsumed: totalLength,
			invalid: false,
		});
	});
});

describe("EventStream frame boundaries", () => {
	it.each(Array.from({ length: 15 }, (_, index) => index + 1))(
		"rejects total length %i below the fixed overhead",
		(totalLength) => {
			const buffer = new Uint8Array(16);
			new DataView(buffer.buffer).setUint32(0, totalLength);
			expect(parseAwsEventStreamFrames(buffer)).toEqual({
				messages: [],
				invalid: true,
				bytesConsumed: 0,
			});
		},
	);

	it("accepts an empty frame at the exact structural minimum", () => {
		expect(parseAwsEventStreamFrames(frame(""))).toEqual({
			messages: [{ headers: {}, payload: new Uint8Array(0) }],
			invalid: false,
			bytesConsumed: 16,
		});
	});

	it.each([[3], [0, 7], [0, 7, 0], [0, 7, 0, 2, 65]])(
		"keeps malformed string fields inside the header section: %j",
		(...header) => {
			const buffer = new Uint8Array(16 + header.length);
			const view = new DataView(buffer.buffer);
			view.setUint32(0, buffer.length);
			view.setUint32(4, header.length);
			buffer.set(header, 12);
			expect(parseAwsEventStreamFrames(buffer)).toEqual({
				messages: [],
				invalid: true,
				bytesConsumed: 0,
			});
		},
	);

	it("retains every split of a valid frame without losing bytes", () => {
		const complete = frame('{"completion":"ok"}');
		for (let split = 0; split < complete.length; split++) {
			expect(parseAwsEventStreamFrames(complete.subarray(0, split))).toEqual({
				messages: [],
				invalid: false,
				bytesConsumed: 0,
			});
		}
	});

	it("accounts for consumed frames in a view with a nonzero byte offset", () => {
		const complete = frame('{"completion":"ok"}');
		const storage = new Uint8Array(complete.length + 32);
		storage.set(complete, 7);
		expect(
			convertAwsEventStreamToSSE(storage.subarray(7, 7 + complete.length + 16)),
		).toEqual({
			sse: 'data: {"completion":"ok"}\n\n',
			bytesConsumed: complete.length,
			invalid: true,
		});
	});
});

it("accepts the full 24 MiB payload plus framing overhead", () => {
	const payloadLength = 24 * 1024 * 1024;
	const buffer = new Uint8Array(payloadLength + 16);
	new DataView(buffer.buffer).setUint32(0, buffer.length);
	const result = parseAwsEventStreamFrames(buffer);
	expect(result.invalid).toBe(false);
	expect(result.bytesConsumed).toBe(buffer.length);
	expect(result.messages[0]?.payload.length).toBe(payloadLength);
});
