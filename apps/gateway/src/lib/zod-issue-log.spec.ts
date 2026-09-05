import { describe, expect, test } from "vitest";
import { z } from "zod";

import { summarizeZodIssues } from "./zod-issue-log.js";

function issuesOf(schema: z.ZodTypeAny, input: unknown) {
	const result = schema.safeParse(input);
	if (result.success) {
		throw new Error("expected validation to fail");
	}
	return result.error.issues;
}

describe("summarizeZodIssues", () => {
	test("keeps path and code but drops rejected values", () => {
		const schema = z.object({
			messages: z.array(
				z.object({
					role: z.enum(["user", "assistant"]),
					content: z.string(),
				}),
			),
			max_tokens: z.number().optional(),
		});
		const summary = summarizeZodIssues(
			issuesOf(schema, {
				messages: [{ role: "top secret prompt", content: 42 }],
				max_tokens: "many",
			}),
		);

		expect(JSON.stringify(summary)).not.toContain("top secret prompt");
		expect(summary).toEqual([
			{ code: "invalid_enum_value", path: "messages.0.role" },
			{
				code: "invalid_type",
				path: "messages.0.content",
				expected: "string",
				received: "number",
			},
			{
				code: "invalid_type",
				path: "max_tokens",
				expected: "number",
				received: "string",
			},
		]);
	});

	test("drops nested union issues and unrecognized keys", () => {
		const schema = z
			.object({
				block: z.union([
					z.object({ type: z.literal("text"), text: z.string() }),
					z.object({ type: z.literal("image"), url: z.string() }),
				]),
			})
			.strict();
		const summary = summarizeZodIssues(
			issuesOf(schema, {
				block: { type: "confidential value", text: "hidden" },
				"leaked key": true,
			}),
		);

		const serialized = JSON.stringify(summary);
		expect(serialized).not.toContain("confidential value");
		expect(serialized).not.toContain("leaked key");
		expect(summary.map((issue) => issue.code).sort()).toEqual([
			"invalid_union",
			"unrecognized_keys",
		]);
	});
});
