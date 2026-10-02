import { describe, expect, it } from "vitest";

import { extractFirstSseEventData } from "./extract-first-sse-event-data.js";

describe("extractFirstSseEventData", () => {
	it.each(["\n", "\r\n", "\r"])(
		"reads an error with %j line endings",
		(newline) => {
			expect(
				extractFirstSseEventData(
					`event: error${newline}data: {"error":"failed"}${newline}${newline}`,
				),
			).toBe('{"error":"failed"}');
		},
	);
	it("returns the first payload event", () => {
		expect(extractFirstSseEventData('data: {"ok":true}\n\n')).toBe(
			'{"ok":true}',
		);
	});

	it("skips heartbeat comments before the first payload event", () => {
		expect(
			extractFirstSseEventData(': ping\n\ndata: {"error":"boom"}\n\n'),
		).toBe('{"error":"boom"}');
	});

	it("skips keepalive events without data before the first payload event", () => {
		expect(
			extractFirstSseEventData(
				'event: keepalive\nid: 1\n\ndata: {"error":"boom"}\n\n',
			),
		).toBe('{"error":"boom"}');
	});

	it("skips empty data events before the first payload event", () => {
		expect(
			extractFirstSseEventData('data:\n\ndata: {"error":"boom"}\n\n'),
		).toBe('{"error":"boom"}');
	});

	it("returns null for incomplete payload events", () => {
		expect(extractFirstSseEventData('data: {"error":"boom"}\n')).toBeNull();
	});
});
