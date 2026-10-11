import { describe, expect, test } from "vitest";

import { orderToolResultReminders } from "./order-tool-result-reminders.js";
import { prepareRequestBody } from "./prepare-request-body.js";

import type { BaseMessage, ProviderId } from "@llmgateway/models";

const assistant: BaseMessage = {
	role: "assistant",
	content: "",
	tool_calls: ["one", "two"].map((id) => ({
		id,
		type: "function",
		function: { name: "lookup", arguments: "{}" },
	})),
};
const first: BaseMessage = {
	role: "tool",
	tool_call_id: "one",
	content: "first result",
};
const second: BaseMessage = {
	role: "user",
	tool_call_id: "two",
	content: "second result",
	tool_result_cache_control: { type: "ephemeral", ttl: "1h" },
};
const reminder: BaseMessage = {
	role: "system",
	content: "Reply briefly.",
};
const anotherReminder: BaseMessage = {
	role: "system",
	content: [
		{
			type: "text",
			text: "Use the results.",
			cache_control: { type: "ephemeral", ttl: "1h" },
		},
	],
};

const interleaved = [assistant, reminder, first, anotherReminder, second];
const ordered = [assistant, first, second, reminder, anotherReminder];

describe("tool-result reminder ordering", () => {
	test("moves reminders after every parallel result without mutating the input", () => {
		const original = structuredClone(interleaved);
		expect(orderToolResultReminders(interleaved)).toEqual(ordered);
		expect(interleaved).toEqual(original);
	});

	test.each([
		[assistant, reminder, first],
		[
			assistant,
			reminder,
			{ role: "user", content: "Continue." },
			first,
			second,
		],
		[assistant, reminder, { ...first, tool_call_id: "unrelated" }, second],
		[assistant, reminder, assistant, first, second],
		[reminder, { role: "user", content: "Hello." }, anotherReminder],
		ordered,
	] satisfies BaseMessage[][])(
		"preserves unrelated or incomplete history %#",
		(...messages) => {
			expect(orderToolResultReminders(messages)).toEqual(messages);
		},
	);

	test("normalizes each tool turn independently", () => {
		expect(orderToolResultReminders([...interleaved, ...interleaved])).toEqual([
			...ordered,
			...ordered,
		]);
	});
});

const mappings: Array<[ProviderId, string]> = [
	["anthropic", "claude-sonnet-5"],
	["anthropic", "claude-haiku-4-5"],
	["vertex-anthropic", "claude-sonnet-5"],
	["azure-anthropic", "claude-haiku-4-5"],
	["aws-bedrock", "claude-haiku-4-5"],
];

for (const mode of ["auto", "passthrough"] as const) {
	test.each(mappings)(
		`%s/%s orders reminders before conversion in ${mode} mode`,
		async (provider, model) => {
			const prepare = (messages: BaseMessage[]) =>
				prepareRequestBody(
					provider,
					model,
					null,
					model,
					[
						{ role: "system", content: "You are helpful." },
						{ role: "user", content: "Look up both." },
						...messages,
					],
					false,
					undefined,
					128,
					undefined,
					undefined,
					undefined,
					undefined,
					undefined,
					undefined,
					undefined,
					undefined,
					false,
					20,
					null,
					undefined,
					undefined,
					undefined,
					undefined,
					undefined,
					undefined,
					undefined,
					undefined,
					undefined,
					mode,
				);
			const original = structuredClone(interleaved);
			expect(await prepare(interleaved)).toEqual(await prepare(ordered));
			expect(interleaved).toEqual(original);
		},
	);
}
