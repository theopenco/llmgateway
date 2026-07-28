import { describe, expect, it } from "vitest";

import { messagesEndWithAssistant } from "./messages-end-with-assistant.js";

import type { BaseMessage } from "@llmgateway/models";

function messages(...roles: BaseMessage["role"][]): BaseMessage[] {
	return roles.map((role) => ({ role, content: "hi" }) as BaseMessage);
}

describe("messagesEndWithAssistant", () => {
	it("detects a trailing assistant turn", () => {
		expect(messagesEndWithAssistant(messages("user", "assistant"))).toBe(true);
	});

	it("ignores assistant turns that are not last", () => {
		expect(
			messagesEndWithAssistant(messages("user", "assistant", "user")),
		).toBe(false);
		expect(
			messagesEndWithAssistant(messages("user", "assistant", "tool")),
		).toBe(false);
	});

	it("handles an empty conversation", () => {
		expect(messagesEndWithAssistant([])).toBe(false);
	});
});
