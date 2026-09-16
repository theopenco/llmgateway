import { describe, expect, test } from "vitest";

import {
	inlineVideoResponse,
	videoProxyResponse,
	videoRangeHeaders,
} from "./video-content.js";

const bytes = new Uint8Array([0, 1, 2, 3, 4]);

describe("video byte ranges", () => {
	test.each([
		["bytes=0-1", [0, 1], "bytes 0-1/5"],
		["bytes=2-", [2, 3, 4], "bytes 2-4/5"],
		["bytes=-2", [3, 4], "bytes 3-4/5"],
		["bytes=3-99", [3, 4], "bytes 3-4/5"],
	] as const)(
		"serves an inline range %s",
		async (range, expected, contentRange) => {
			const response = inlineVideoResponse(
				bytes,
				"video/mp4",
				new Headers({ Range: range }),
			);
			expect(response.status).toBe(206);
			expect(response.headers.get("Content-Range")).toBe(contentRange);
			expect(response.headers.get("Content-Length")).toBe(
				String(expected.length),
			);
			expect([...new Uint8Array(await response.arrayBuffer())]).toEqual(
				expected,
			);
		},
	);

	test.each(["bytes=5-", "bytes=2-1", "bytes=-0", "bytes=-", "bytes=0-1,3-4"])(
		"rejects an unsupported range %s",
		(range) => {
			const response = inlineVideoResponse(
				bytes,
				"video/mp4",
				new Headers({ Range: range }),
			);
			expect(response.status).toBe(416);
			expect(response.headers.get("Content-Range")).toBe("bytes */5");
		},
	);

	test("sends full inline content when If-Range cannot be validated", async () => {
		const response = inlineVideoResponse(
			bytes,
			"video/mp4",
			new Headers({ Range: "bytes=0-1", "If-Range": '"old"' }),
		);
		expect(response.status).toBe(200);
		expect((await response.arrayBuffer()).byteLength).toBe(5);
	});

	test("forwards range validators without forwarding account credentials", () => {
		expect(
			videoRangeHeaders(
				new Headers({
					Range: "bytes=0-1",
					"If-Range": '"version"',
					Authorization: "Bearer test-token",
				}),
			),
		).toEqual({ Range: "bytes=0-1", "If-Range": '"version"' });
	});

	test("preserves partial content and range headers from upstream", async () => {
		const response = videoProxyResponse(
			new Response(bytes.slice(0, 2), {
				status: 206,
				headers: {
					"Content-Range": "bytes 0-1/5",
					"Accept-Ranges": "bytes",
					"Content-Length": "2",
					ETag: '"version"',
					"Set-Cookie": "private",
				},
			}),
		);
		expect(response.status).toBe(206);
		expect(response.headers.get("Content-Range")).toBe("bytes 0-1/5");
		expect(response.headers.get("ETag")).toBe('"version"');
		expect(response.headers.has("Set-Cookie")).toBe(false);
		expect((await response.arrayBuffer()).byteLength).toBe(2);
	});

	test("preserves unsatisfiable ranges and reports other upstream failures", () => {
		const response = videoProxyResponse(
			new Response(null, {
				status: 416,
				headers: { "Content-Range": "bytes */5" },
			}),
		);
		expect(response.status).toBe(416);
		expect(response.headers.get("Content-Range")).toBe("bytes */5");
		expect(() =>
			videoProxyResponse(new Response(null, { status: 500 })),
		).toThrow("Failed to fetch video content");
	});
});
