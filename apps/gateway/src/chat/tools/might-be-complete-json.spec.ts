import { describe, it, expect } from "vitest";

import { mightBeCompleteJson } from "./might-be-complete-json.js";

describe("mightBeCompleteJson", () => {
	it("returns true for simple valid object", () => {
		expect(mightBeCompleteJson('{"a":1}')).toBe(true);
	});

	it("returns true for simple valid array", () => {
		expect(mightBeCompleteJson("[1,2,3]")).toBe(true);
	});

	it("returns false for incomplete object", () => {
		expect(mightBeCompleteJson('{"a":1')).toBe(false);
	});

	it("returns false for incomplete array", () => {
		expect(mightBeCompleteJson("[1,2")).toBe(false);
	});

	it("returns false for empty string", () => {
		expect(mightBeCompleteJson("")).toBe(false);
	});

	it("returns false for non-JSON", () => {
		expect(mightBeCompleteJson("hello")).toBe(false);
	});

	it("handles brackets inside strings correctly", () => {
		// This is the bug case - brackets inside string values should be ignored
		expect(mightBeCompleteJson('{"delta":"\\"]"}')).toBe(true);
	});

	it("handles braces inside strings correctly", () => {
		expect(mightBeCompleteJson('{"data":"}{{"}')).toBe(true);
	});

	it("handles escaped quotes inside strings", () => {
		expect(mightBeCompleteJson('{"text":"say \\"hello\\""}')).toBe(true);
	});

	it("handles escaped backslashes", () => {
		expect(mightBeCompleteJson('{"path":"C:\\\\Users"}')).toBe(true);
	});

	it("returns false for unclosed string", () => {
		expect(mightBeCompleteJson('{"text":"unclosed}')).toBe(false);
	});

	it("handles nested objects", () => {
		expect(mightBeCompleteJson('{"a":{"b":{"c":1}}}')).toBe(true);
	});

	it("handles arrays with objects", () => {
		expect(mightBeCompleteJson('[{"a":1},{"b":2}]')).toBe(true);
	});

	it("handles the actual failing case from production", () => {
		// This was causing the JSON parse error in production
		const json =
			'{"type":"response.function_call_arguments.delta","delta":"\\"]","item_id":"fc_test","output_index":1}';
		expect(mightBeCompleteJson(json)).toBe(true);
	});

	it("handles complex nested structure with brackets in strings", () => {
		const json = '{"choices":[{"delta":{"content":"array[0] = {value}"}}]}';
		expect(mightBeCompleteJson(json)).toBe(true);
	});

	it("returns false for actually unbalanced braces", () => {
		expect(mightBeCompleteJson('{"a":1}}')).toBe(false);
	});

	it("returns false for actually unbalanced brackets", () => {
		expect(mightBeCompleteJson("[1,2]]")).toBe(false);
	});
});
