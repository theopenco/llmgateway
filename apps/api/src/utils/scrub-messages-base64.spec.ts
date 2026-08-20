import { expect, test } from "vitest";

import { scrubMessagesBase64 } from "./scrub-messages-base64.js";

test("bounds deeply nested payloads without overflowing the call stack", () => {
	const messages: Record<string, unknown> = {};
	let nested = messages;

	for (let depth = 0; depth < 10_000; depth++) {
		const next: Record<string, unknown> = {};
		nested.content = next;
		nested = next;
	}

	nested.image = `data:image/png;base64,${"a".repeat(1_000)}`;

	const scrubbed = scrubMessagesBase64(messages);
	const serialized = JSON.stringify(scrubbed);

	expect(serialized).toContain("[nested_content_truncated]");
	expect(serialized).not.toContain("data:image/png;base64");
});

test("redacts base64 in regular message payloads", () => {
	const messages = [
		{
			role: "user",
			content: `data:image/png;base64,${"a".repeat(1_000)}`,
		},
	];

	expect(scrubMessagesBase64(messages)).toEqual([
		{
			role: "user",
			content: "[base64_image_input_redacted]",
		},
	]);
});
