import { describe, expect, test } from "vitest";

import { parseToolCallArguments } from "./parse-tool-call-arguments.js";
import { RequestError } from "./request-error.js";

import type { ToolCall } from "@llmgateway/models";

function makeToolCall(args: string): ToolCall {
	return {
		id: "call_123",
		type: "function",
		function: {
			name: "get_weather",
			arguments: args,
		},
	};
}

describe("parseToolCallArguments", () => {
	test("parses a valid JSON object", () => {
		expect(parseToolCallArguments(makeToolCall('{"city":"Berlin"}'))).toEqual({
			city: "Berlin",
		});
	});

	test("returns an empty object for empty or whitespace arguments", () => {
		expect(parseToolCallArguments(makeToolCall(""))).toEqual({});
		expect(parseToolCallArguments(makeToolCall("  "))).toEqual({});
		expect(
			parseToolCallArguments(makeToolCall(undefined as unknown as string)),
		).toEqual({});
	});

	test("throws a RequestError for malformed JSON", () => {
		let thrown: unknown;
		try {
			parseToolCallArguments(makeToolCall('{"city":"Berlin"'));
		} catch (e) {
			thrown = e;
		}
		expect(thrown).toBeInstanceOf(RequestError);
		expect((thrown as RequestError).statusCode).toBe(400);
		expect((thrown as RequestError).message).toContain("get_weather");
		expect((thrown as RequestError).message).toContain("call_123");
	});

	test("throws a RequestError for non-object JSON values", () => {
		for (const args of ["42", '"text"', "[1,2]", "null", "true"]) {
			expect(() => parseToolCallArguments(makeToolCall(args))).toThrow(
				RequestError,
			);
		}
	});
});
