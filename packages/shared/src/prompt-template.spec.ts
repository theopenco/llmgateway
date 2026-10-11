import { describe, expect, test } from "vitest";

import {
	extractPromptVariables,
	parsePromptModelReference,
	PromptVariableError,
	renderPromptTemplate,
} from "./prompt-template.js";

describe("prompt templates", () => {
	const messages = [
		{ role: "system" as const, content: "You answer for {{ company }}." },
		{ role: "user" as const, content: "Summarize {{topic}} for {{company}}." },
	];

	test("extracts distinct variables in first-seen order", () => {
		expect(extractPromptVariables(messages)).toEqual(["company", "topic"]);
	});

	test("renders every placeholder", () => {
		expect(
			renderPromptTemplate(messages, { company: "Acme", topic: "routing" }),
		).toEqual([
			{ role: "system", content: "You answer for Acme." },
			{ role: "user", content: "Summarize routing for Acme." },
		]);
	});

	test("rejects missing variables by name", () => {
		expect(() => renderPromptTemplate(messages, { company: "Acme" })).toThrow(
			new PromptVariableError("Missing prompt variables: topic"),
		);
	});

	test("does not re-expand placeholders inside values", () => {
		const [, user] = renderPromptTemplate(messages, {
			company: "{{topic}}",
			topic: "x",
		});
		expect(user.content).toBe("Summarize x for {{topic}}.");
	});

	test("ignores inherited object keys", () => {
		expect(() =>
			renderPromptTemplate([{ role: "user", content: "{{constructor}}" }], {}),
		).toThrow(/Missing prompt variables: constructor/);
	});
});

describe("parsePromptModelReference", () => {
	test("parses name, label and version forms", () => {
		expect(parsePromptModelReference("@prompt/support-reply")).toEqual({
			id: "support-reply",
		});
		expect(parsePromptModelReference("@prompt/support-reply@staging")).toEqual({
			id: "support-reply",
			label: "staging",
		});
		expect(parsePromptModelReference("@prompt/support-reply@12")).toEqual({
			id: "support-reply",
			version: 12,
		});
		expect(parsePromptModelReference("@prompt/v1.2-beta@latest")).toEqual({
			id: "v1.2-beta",
			label: "latest",
		});
	});

	test("ignores ordinary models and rejects malformed references", () => {
		for (const value of [
			"gpt-4o-mini",
			"openai/gpt-4o",
			"@preset/x",
			"@prompt/",
			"@prompt/name@",
			"@prompt/name@0",
			"@prompt/name@a@b",
			"@prompt/name@bad label",
			undefined,
			42,
		]) {
			expect(parsePromptModelReference(value)).toBeUndefined();
		}
	});
});
