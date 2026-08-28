import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
	convertAwsEventStreamToSSE,
	parseAwsEventStream,
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
		// cannot fit inside the message. The guard must stop rather than read
		// past the buffer.
		const buffer = new Uint8Array(16);
		const view = new DataView(buffer.buffer);
		view.setUint32(0, 16, false); // total length
		view.setUint32(4, 0xffffffff, false); // headers length

		expect(() => parseAwsEventStream(buffer)).not.toThrow();
		expect(parseAwsEventStream(buffer)).toEqual([]);
	});
});
