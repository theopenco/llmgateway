import { describe, expect, test } from "vitest";

import {
	extractPromptVariables,
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
