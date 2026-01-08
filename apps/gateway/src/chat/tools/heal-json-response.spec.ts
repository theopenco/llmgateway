import { describe, expect, it } from "vitest";

import {
	healAndValidateJson,
	healJsonResponse,
	validateJsonSchema,
} from "./heal-json-response.js";

describe("healJsonResponse", () => {
	describe("valid JSON (no healing needed)", () => {
		it("should return unmodified valid JSON object", () => {
			const input = '{"name": "test", "value": 123}';
			const result = healJsonResponse(input);

			expect(result.healed).toBe(false);
			expect(result.content).toBe(input);
		});

		it("should return unmodified valid JSON array", () => {
			const input = '[1, 2, 3, "test"]';
			const result = healJsonResponse(input);

			expect(result.healed).toBe(false);
			expect(result.content).toBe(input);
		});

		it("should handle nested valid JSON", () => {
			const input = '{"outer": {"inner": {"deep": true}}, "array": [1, 2, 3]}';
			const result = healJsonResponse(input);

			expect(result.healed).toBe(false);
			expect(result.content).toBe(input);
		});
	});

	describe("markdown extraction", () => {
		it("should extract JSON from ```json code blocks", () => {
			const input = 'Here is the data:\n```json\n{"name": "test"}\n```\nDone!';
			const result = healJsonResponse(input);

			expect(result.healed).toBe(true);
			expect(result.healingMethod).toBe("markdown_extraction");
			expect(JSON.parse(result.content)).toEqual({ name: "test" });
		});

		it("should extract JSON from generic ``` code blocks", () => {
			const input = '```\n{"value": 42}\n```';
			const result = healJsonResponse(input);

			expect(result.healed).toBe(true);
			expect(JSON.parse(result.content)).toEqual({ value: 42 });
		});

		it("should handle multiline JSON in code blocks", () => {
			const input = `\`\`\`json
{
  "users": [
    {"name": "Alice", "age": 30},
    {"name": "Bob", "age": 25}
  ]
}
\`\`\``;
			const result = healJsonResponse(input);

			expect(result.healed).toBe(true);
			expect(JSON.parse(result.content).users).toHaveLength(2);
		});
	});

	describe("mixed content extraction", () => {
		it("should extract JSON from surrounding text", () => {
			const input =
				'The response is: {"status": "success", "code": 200} as expected.';
			const result = healJsonResponse(input);

			expect(result.healed).toBe(true);
			expect(result.healingMethod).toBe("mixed_content_extraction");
			expect(JSON.parse(result.content)).toEqual({
				status: "success",
				code: 200,
			});
		});

		it("should extract array from surrounding text", () => {
			const input = "Here are the numbers: [1, 2, 3, 4, 5] in sequence.";
			const result = healJsonResponse(input);

			expect(result.healed).toBe(true);
			expect(JSON.parse(result.content)).toEqual([1, 2, 3, 4, 5]);
		});

		it("should handle brackets inside strings correctly", () => {
			const input =
				'Text with { bracket } and then {"valid": "json with } inside"}';
			const result = healJsonResponse(input);

			expect(result.healed).toBe(true);
			expect(JSON.parse(result.content)).toEqual({
				valid: "json with } inside",
			});
		});

		it("should skip invalid first bracket and find valid JSON later", () => {
			const input =
				'Some text { not valid json } but here is {"actual": "data"}';
			const result = healJsonResponse(input);

			expect(result.healed).toBe(true);
			expect(JSON.parse(result.content)).toEqual({ actual: "data" });
		});

		it("should handle nested objects with brackets in string values", () => {
			const input =
				'Response: {"outer": {"message": "Use {braces} here"}, "code": 200}';
			const result = healJsonResponse(input);

			expect(result.healed).toBe(true);
			expect(JSON.parse(result.content)).toEqual({
				outer: { message: "Use {braces} here" },
				code: 200,
			});
		});

		it("should handle escaped quotes in strings", () => {
			const input = 'Result: {"text": "He said \\"hello\\"", "count": 1}';
			const result = healJsonResponse(input);

			expect(result.healed).toBe(true);
			expect(JSON.parse(result.content)).toEqual({
				text: 'He said "hello"',
				count: 1,
			});
		});

		it("should handle arrays with objects containing brackets in strings", () => {
			const input =
				'Data: [{"name": "test[1]"}, {"name": "test{2}"}] is the list.';
			const result = healJsonResponse(input);

			expect(result.healed).toBe(true);
			expect(JSON.parse(result.content)).toEqual([
				{ name: "test[1]" },
				{ name: "test{2}" },
			]);
		});
	});

	describe("syntax fixes", () => {
		it("should remove trailing commas before closing brace", () => {
			const input = '{"name": "test", "value": 123,}';
			const result = healJsonResponse(input);

			expect(result.healed).toBe(true);
			expect(result.healingMethod).toBe("syntax_fix");
			expect(JSON.parse(result.content)).toEqual({ name: "test", value: 123 });
		});

		it("should remove trailing commas before closing bracket", () => {
			const input = "[1, 2, 3,]";
			const result = healJsonResponse(input);

			expect(result.healed).toBe(true);
			expect(JSON.parse(result.content)).toEqual([1, 2, 3]);
		});

		it("should fix unquoted keys", () => {
			const input = '{name: "test", value: 123}';
			const result = healJsonResponse(input);

			expect(result.healed).toBe(true);
			expect(JSON.parse(result.content)).toEqual({ name: "test", value: 123 });
		});

		it("should convert single quotes to double quotes", () => {
			const input = "{'name': 'test'}";
			const result = healJsonResponse(input);

			expect(result.healed).toBe(true);
			expect(JSON.parse(result.content)).toEqual({ name: "test" });
		});
	});

	describe("truncation completion", () => {
		it("should complete missing closing brace", () => {
			const input = '{"name": "test"';
			const result = healJsonResponse(input);

			expect(result.healed).toBe(true);
			expect(result.healingMethod).toBe("truncation_completion");
			expect(JSON.parse(result.content)).toEqual({ name: "test" });
		});

		it("should complete missing closing bracket", () => {
			const input = "[1, 2, 3";
			const result = healJsonResponse(input);

			expect(result.healed).toBe(true);
			expect(JSON.parse(result.content)).toEqual([1, 2, 3]);
		});

		it("should complete nested unclosed structures", () => {
			const input = '{"outer": {"inner": "value"';
			const result = healJsonResponse(input);

			expect(result.healed).toBe(true);
			expect(JSON.parse(result.content)).toEqual({
				outer: { inner: "value" },
			});
		});

		it("should close unclosed strings", () => {
			const input = '{"name": "incomplete';
			const result = healJsonResponse(input);

			expect(result.healed).toBe(true);
			// The healed content should be valid JSON
			expect(() => JSON.parse(result.content)).not.toThrow();
		});
	});

	describe("combined strategies", () => {
		it("should handle markdown with trailing comma", () => {
			const input = '```json\n{"name": "test",}\n```';
			const result = healJsonResponse(input);

			expect(result.healed).toBe(true);
			expect(JSON.parse(result.content)).toEqual({ name: "test" });
		});

		it("should handle truncated JSON with missing brackets", () => {
			const input = '{"data": {"value": 42';
			const result = healJsonResponse(input);

			expect(result.healed).toBe(true);
			expect(JSON.parse(result.content)).toEqual({ data: { value: 42 } });
		});
	});

	describe("irreparable content", () => {
		it("should return original content when healing fails", () => {
			const input = "This is not JSON at all, just plain text.";
			const result = healJsonResponse(input);

			expect(result.healed).toBe(false);
			expect(result.content).toBe(input);
		});

		it("should handle empty string", () => {
			const input = "";
			const result = healJsonResponse(input);

			expect(result.healed).toBe(false);
		});
	});
});

describe("validateJsonSchema", () => {
	it("should validate object type", () => {
		const schema = { type: "object" };
		expect(validateJsonSchema('{"key": "value"}', schema)).toBe(true);
		expect(validateJsonSchema("[1, 2, 3]", schema)).toBe(false);
	});

	it("should validate array type", () => {
		const schema = { type: "array" };
		expect(validateJsonSchema("[1, 2, 3]", schema)).toBe(true);
		expect(validateJsonSchema('{"key": "value"}', schema)).toBe(false);
	});

	it("should validate required properties", () => {
		const schema = {
			type: "object",
			required: ["name", "age"],
		};
		expect(validateJsonSchema('{"name": "John", "age": 30}', schema)).toBe(
			true,
		);
		expect(validateJsonSchema('{"name": "John"}', schema)).toBe(false);
	});

	it("should validate property types", () => {
		const schema = {
			type: "object",
			properties: {
				name: { type: "string" },
				age: { type: "number" },
				active: { type: "boolean" },
			},
		};
		expect(
			validateJsonSchema('{"name": "John", "age": 30, "active": true}', schema),
		).toBe(true);
		expect(
			validateJsonSchema('{"name": 123, "age": 30, "active": true}', schema),
		).toBe(false);
	});

	it("should return false for invalid JSON", () => {
		const schema = { type: "object" };
		expect(validateJsonSchema("not json", schema)).toBe(false);
	});
});

describe("healAndValidateJson", () => {
	it("should heal and validate successfully", () => {
		const input = '{"name": "test",}'; // trailing comma
		const schema = {
			type: "object",
			required: ["name"],
			properties: { name: { type: "string" } },
		};

		const result = healAndValidateJson(input, schema);

		expect(result.healed).toBe(true);
		expect(result.valid).toBe(true);
		expect(JSON.parse(result.content)).toEqual({ name: "test" });
	});

	it("should heal but fail validation if schema doesn't match", () => {
		const input = '{"value": 123,}';
		const schema = {
			type: "object",
			required: ["name"],
		};

		const result = healAndValidateJson(input, schema);

		expect(result.healed).toBe(true);
		expect(result.valid).toBe(false);
	});

	it("should work without schema (just validates JSON)", () => {
		const input = '{"test": true,}';
		const result = healAndValidateJson(input);

		expect(result.healed).toBe(true);
		expect(result.valid).toBe(true);
	});
});
