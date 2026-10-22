import { describe, expect, it } from "vitest";

import { isValidBase64ImageDataUrl } from "./data-url.js";

describe("isValidBase64ImageDataUrl", () => {
	it("accepts base64 image data URLs", () => {
		expect(isValidBase64ImageDataUrl("data:image/png;base64,iVBORw0K+/=")).toBe(
			true,
		);
		expect(
			isValidBase64ImageDataUrl("data:image/svg+xml;base64,PHN2\nZz4="),
		).toBe(true);
	});

	it("rejects invalid data URLs", () => {
		expect(isValidBase64ImageDataUrl("data:image/png;base64,")).toBe(false);
		expect(isValidBase64ImageDataUrl("data:image/png;base64,ab$c")).toBe(false);
		expect(isValidBase64ImageDataUrl("data:text/plain;base64,YWJj")).toBe(
			false,
		);
		expect(isValidBase64ImageDataUrl("https://example.com/a.png")).toBe(false);
	});

	it("handles very large payloads without overflowing the stack", () => {
		const payload = "A".repeat(64 * 1024 * 1024);
		expect(isValidBase64ImageDataUrl(`data:image/png;base64,${payload}`)).toBe(
			true,
		);
		expect(isValidBase64ImageDataUrl(`data:image/png;base64,${payload}!`)).toBe(
			false,
		);
	});
});
