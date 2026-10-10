import { describe, expect, it } from "vitest";

import { extractSseEventData } from "./extract-sse-event-data.js";

describe("extractSseEventData", () => {
	it("returns the first payload event", () => {
		expect(extractSseEventData('data: {"ok":true}\n\n')).toEqual([
			'{"ok":true}',
		]);
	});

	it("skips heartbeat comments before the first payload event", () => {
		expect(extractSseEventData(': ping\n\ndata: {"error":"boom"}\n\n')).toEqual(
			['{"error":"boom"}'],
		);
	});

	it("skips keepalive events without data before the first payload event", () => {
		expect(
			extractSseEventData(
				'event: keepalive\nid: 1\n\ndata: {"error":"boom"}\n\n',
			),
		).toEqual(['{"error":"boom"}']);
	});

	it("skips empty data events before the first payload event", () => {
		expect(extractSseEventData('data:\n\ndata: {"error":"boom"}\n\n')).toEqual([
			'{"error":"boom"}',
		]);
	});

	it("returns every complete payload in order", () => {
		expect(
			extractSseEventData(
				'data: {"type":"response.created"}\n\ndata: {"type":"error"}\n\ndata: {"partial"',
			),
		).toEqual(['{"type":"response.created"}', '{"type":"error"}']);
	});

	it("returns nothing for incomplete payload events", () => {
		expect(extractSseEventData('data: {"error":"boom"}\n')).toEqual([]);
	});
});
