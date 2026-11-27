import { ImageResponse } from "next/og";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { inspectShareImage } from "./share-image";

const PNG_1X1 = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
	"base64",
);

function png(width: number, height: number): Buffer {
	const bytes = Buffer.from(PNG_1X1);
	bytes.writeUInt32BE(width, 16);
	bytes.writeUInt32BE(height, 20);
	return bytes;
}

function jpeg(width: number, height: number): Buffer {
	return Buffer.from([
		...[0xff, 0xd8],
		...[0xff, 0xe0, 0x00, 0x04, 0x00, 0x00],
		...[0xff, 0xc0, 0x00, 0x11, 0x08],
		...[height >> 8, height & 0xff, width >> 8, width & 0xff],
		...[0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01],
	]);
}

function riff(chunk: string, payload: number[]): Buffer {
	const body = Buffer.concat([
		Buffer.from("WEBP"),
		Buffer.from(chunk),
		Buffer.alloc(4),
		Buffer.from(payload),
	]);
	const bytes = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), body]);
	bytes.writeUInt32LE(body.length, 4);
	return Buffer.concat([bytes, Buffer.alloc(8)]);
}

// A JPEG cut off inside its first segment, as sent to the share OG route.
const TRUNCATED_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);

describe("inspectShareImage", () => {
	it("reads the type and size of well-formed images", () => {
		expect(inspectShareImage(PNG_1X1)).toEqual({
			mediaType: "image/png",
			width: 1,
			height: 1,
		});
		expect(inspectShareImage(jpeg(640, 480))).toEqual({
			mediaType: "image/jpeg",
			width: 640,
			height: 480,
		});
		const gif = Buffer.from("GIF89a\x20\x03\x58\x02\x00\x00\x00", "latin1");
		expect(inspectShareImage(gif)).toEqual({
			mediaType: "image/gif",
			width: 800,
			height: 600,
		});
		expect(
			inspectShareImage(
				riff("VP8X", [0, 0, 0, 0, 0xff, 0x03, 0x00, 0xff, 0x01, 0x00]),
			),
		).toEqual({ mediaType: "image/webp", width: 1024, height: 512 });
		expect(
			inspectShareImage(
				riff("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, 0x40, 0x01, 0xf0, 0x00]),
			),
		).toEqual({ mediaType: "image/webp", width: 320, height: 240 });
	});

	it("uses the bytes, not a declared type", () => {
		expect(inspectShareImage(Buffer.from("<!doctype html><html>"))).toBeNull();
		expect(inspectShareImage(Buffer.alloc(0))).toBeNull();
	});

	it("rejects truncated and malformed headers", () => {
		expect(inspectShareImage(TRUNCATED_JPEG)).toBeNull();
		expect(inspectShareImage(PNG_1X1.subarray(0, 20))).toBeNull();
		expect(inspectShareImage(jpeg(640, 480).subarray(0, 14))).toBeNull();
		expect(inspectShareImage(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toBeNull();
		expect(inspectShareImage(png(0, 10))).toBeNull();
	});

	it("rejects images too large to decode safely", () => {
		expect(inspectShareImage(png(2048, 4096))).not.toBeNull();
		expect(inspectShareImage(png(4096, 4096))).toBeNull();
		expect(inspectShareImage(png(30_000, 30_000))).toBeNull();
		expect(inspectShareImage(png(8193, 10))).toBeNull();
		expect(inspectShareImage(png(8192, 4096))).toBeNull();
		expect(inspectShareImage(jpeg(65_535, 65_535))).toBeNull();
	});

	it("rejects the input that crashed the OG renderer", async () => {
		const src = `data:image/jpeg;base64,${TRUNCATED_JPEG.toString("base64")}`;
		await expect(
			new ImageResponse(createElement("img", { src, width: 10, height: 10 }), {
				width: 10,
				height: 10,
			}).arrayBuffer(),
		).rejects.toThrow(RangeError);
		expect(inspectShareImage(TRUNCATED_JPEG)).toBeNull();
	});
});
