import { describe, expect, it } from "vitest";

import { deriveCallTitle, formatCallDuration } from "./call-history";

describe("formatCallDuration", () => {
	it("formats sub-minute durations", () => {
		expect(formatCallDuration(0)).toBe("0:00");
		expect(formatCallDuration(7)).toBe("0:07");
		expect(formatCallDuration(59)).toBe("0:59");
	});

	it("formats durations past a minute", () => {
		expect(formatCallDuration(60)).toBe("1:00");
		expect(formatCallDuration(605)).toBe("10:05");
	});

	it("clamps invalid input", () => {
		expect(formatCallDuration(-5)).toBe("0:00");
		expect(formatCallDuration(Number.NaN)).toBe("0:00");
	});
});

describe("deriveCallTitle", () => {
	it("prefers the first thing the user said", () => {
		expect(
			deriveCallTitle([
				{ role: "assistant", text: "Hi, how can I help?" },
				{ role: "user", text: "Book me a table" },
			]),
		).toBe("Book me a table");
	});

	it("falls back to the assistant when the user turn is empty", () => {
		expect(
			deriveCallTitle([
				{ role: "user", text: "   " },
				{ role: "assistant", text: "Hi, how can I help?" },
			]),
		).toBe("Hi, how can I help?");
	});

	it("labels a call with no usable text", () => {
		expect(deriveCallTitle([])).toBe("Voice call");
		expect(deriveCallTitle([{ role: "user", text: "  " }])).toBe("Voice call");
	});

	it("truncates long openings with an ellipsis", () => {
		const title = deriveCallTitle([{ role: "user", text: "a".repeat(120) }]);
		expect(title).toHaveLength(61);
		expect(title.endsWith("…")).toBe(true);
	});

	it("keeps a title exactly at the limit intact", () => {
		const text = "b".repeat(60);
		expect(deriveCallTitle([{ role: "user", text }])).toBe(text);
	});
});
