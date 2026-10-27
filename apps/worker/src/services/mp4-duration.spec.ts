import { describe, expect, it } from "vitest";

import { readMp4DurationSeconds } from "./mp4-duration.js";

function box(type: string, payload: Buffer): Buffer {
	const header = Buffer.alloc(8);
	header.writeUInt32BE(8 + payload.length, 0);
	header.write(type, 4, "latin1");
	return Buffer.concat([header, payload]);
}

function largeBox(type: string, payload: Buffer): Buffer {
	const header = Buffer.alloc(16);
	header.writeUInt32BE(1, 0);
	header.write(type, 4, "latin1");
	header.writeBigUInt64BE(BigInt(16 + payload.length), 8);
	return Buffer.concat([header, payload]);
}

function mvhdV0(timescale: number, duration: number): Buffer {
	const body = Buffer.alloc(100);
	body.writeUInt32BE(timescale, 12);
	body.writeUInt32BE(duration, 16);
	return box("mvhd", body);
}

function mvhdV1(timescale: number, duration: bigint): Buffer {
	const body = Buffer.alloc(112);
	body.writeUInt8(1, 0);
	body.writeUInt32BE(timescale, 20);
	body.writeBigUInt64BE(duration, 24);
	return box("mvhd", body);
}

function reader(file: Buffer) {
	const reads: Array<[number, number]> = [];
	return {
		reads,
		read: async (start: number, length: number) => {
			reads.push([start, length]);
			if (start >= file.length) {
				throw new Error("range not satisfiable");
			}
			return file.subarray(start, start + length);
		},
	};
}

describe("readMp4DurationSeconds", () => {
	it("reads a trailing moov after mdat with small range reads", async () => {
		const file = Buffer.concat([
			box("ftyp", Buffer.from("isom0000isomiso2")),
			box("free", Buffer.alloc(0)),
			box("mdat", Buffer.alloc(50_000)),
			box(
				"moov",
				Buffer.concat([mvhdV0(1000, 4240), box("trak", Buffer.alloc(64))]),
			),
		]);
		const { read, reads } = reader(file);

		await expect(readMp4DurationSeconds(read)).resolves.toBe(4.24);
		expect(reads.every(([, length]) => length <= 40)).toBe(true);
		expect(reads).toHaveLength(5);
	});

	it("reads a version 1 mvhd and 64-bit box sizes", async () => {
		const file = Buffer.concat([
			largeBox("mdat", Buffer.alloc(128)),
			box("moov", mvhdV1(90_000, 3_182_400n)),
		]);

		await expect(readMp4DurationSeconds(reader(file).read)).resolves.toBe(
			35.36,
		);
	});

	it("skips moov children before mvhd", async () => {
		const file = box(
			"moov",
			Buffer.concat([box("udta", Buffer.alloc(24)), mvhdV0(600, 1500)]),
		);

		await expect(readMp4DurationSeconds(reader(file).read)).resolves.toBe(2.5);
	});

	it("throws when the file has no movie header", async () => {
		const file = Buffer.concat([
			box("ftyp", Buffer.alloc(8)),
			box("mdat", Buffer.alloc(16)),
		]);

		await expect(readMp4DurationSeconds(reader(file).read)).rejects.toThrow();
	});

	it("throws on a zero duration", async () => {
		const file = box("moov", mvhdV0(1000, 0));

		await expect(readMp4DurationSeconds(reader(file).read)).rejects.toThrow(
			"moov/mvhd",
		);
	});
});
