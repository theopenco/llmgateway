import { describe, expect, test } from "vitest";

import { getLLMText } from "./get-llm-text";

describe("LLM markdown export", () => {
	test("keeps callout prose and JSX examples without leaking component wrappers", async () => {
		const page = {
			url: "/developers/mcp",
			data: {
				title: "MCP",
				getText: async () =>
					'<Callout type="info">\nUse this endpoint.\n</Callout>\n\n```tsx\n<Callout>Example</Callout>\n```',
			},
		} as Parameters<typeof getLLMText>[0];
		const text = await getLLMText(page);
		expect(text).toContain("Use this endpoint.");
		expect(text).not.toContain('<Callout type="info">');
		expect(text).toContain("```tsx\n<Callout>Example</Callout>\n```");
	});
});
