import { describe, expect, it } from "vitest";

import { allowsFileType, isRecognizedFileTypeEntry } from "./file-types.js";

describe("file type allow-list entries", () => {
	it.each([
		[
			"docx",
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		],
		["svg", "image/svg+xml"],
		["htm", "text/html"],
		["mpga", "audio/mpeg"],
		[
			"xlsx",
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		],
		["pdf", "application/pdf"],
		[".PNG", "image/png"],
	])("matches %s against %s", (entry, mimeType) => {
		expect(isRecognizedFileTypeEntry(entry)).toBe(true);
		expect(allowsFileType(entry, mimeType)).toBe(true);
	});

	it.each(["pfd", "docs", "", "image/", "not a type"])(
		"does not recognize %j",
		(entry) => {
			expect(isRecognizedFileTypeEntry(entry)).toBe(false);
		},
	);

	it("recognizes MIME types and wildcards", () => {
		expect(isRecognizedFileTypeEntry("application/x-custom")).toBe(true);
		expect(isRecognizedFileTypeEntry("image/*")).toBe(true);
	});
});
