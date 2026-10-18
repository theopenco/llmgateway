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

	test("keeps component names written as inline code", async () => {
		const page = {
			url: "/features/embeddable-payments",
			data: {
				title: "Embeddable payments",
				getText: async () =>
					'Wrap your UI in `<LLMGatewayProvider>` and pass `mode="test"` to ``<Wallet />``.\n\n<Callout>Done.</Callout>',
			},
		} as Parameters<typeof getLLMText>[0];
		const text = await getLLMText(page);
		expect(text).toContain("Wrap your UI in `<LLMGatewayProvider>`");
		expect(text).toContain("``<Wallet />``");
		expect(text).toContain("Done.");
		expect(text).not.toContain("<Callout>");
	});

	test("removes component tags whose quoted attributes contain >", async () => {
		const page = {
			url: "/guides/limits",
			data: {
				title: "Limits",
				getText: async () =>
					'<Callout title="a > b">\nKeep this.\n</Callout>\n\nPress <Kbd label="x > y">Enter</Kbd> to send.',
			},
		} as Parameters<typeof getLLMText>[0];
		const text = await getLLMText(page);
		expect(text).toContain("Keep this.");
		expect(text).toContain("Press Enter to send.");
		expect(text).not.toContain('b">');
		expect(text).not.toContain('y">');
		expect(text).not.toContain("</Callout>");
	});

	test("keeps component names in inline code that spans lines", async () => {
		const page = {
			url: "/features/embeddable-payments",
			data: {
				title: "Embeddable payments",
				getText: async () =>
					'Render `<Wallet\n  mode="test" />` inside the provider.',
			},
		} as Parameters<typeof getLLMText>[0];
		const text = await getLLMText(page);
		expect(text).toContain(
			'Render `<Wallet\n  mode="test" />` inside the provider.',
		);
	});

	test("swaps navigation cards and drops other standalone components", async () => {
		const page = {
			url: "/",
			data: {
				title: "Home",
				getText: async () =>
					'Intro.\n\n<FeatureCards />\n\n<Cards>\n  <Card title="Quickstart" href="/quick-start" />\n</Cards>\n\nOutro.',
			},
		} as Parameters<typeof getLLMText>[0];
		const text = await getLLMText(page);
		expect(text).toContain("All features are documented under");
		expect(text).not.toContain("<Card");
		expect(text).not.toContain("</Cards>");
		expect(text).not.toMatch(/\n{3,}/);
		expect(text).toContain("Outro.");
	});

	test("unwraps nested block components back to their parent's indentation", async () => {
		const page = {
			url: "/airside",
			data: {
				title: "Airside",
				getText: async () =>
					"## Quick start\n\n<Steps>\n  <Step>\n    ### Sign up\n\n    Create an account.\n  </Step>\n\n  <Step>\n    ### Install\n\n    ```bash\n    npm i\n\n\n    npx init\n    ```\n  </Step>\n</Steps>\n\n- Item\n\n  <Callout>\n    Note.\n  </Callout>\n\n## Next",
			},
		} as Parameters<typeof getLLMText>[0];
		const text = await getLLMText(page);
		expect(text).toContain(
			"## Quick start\n\n### Sign up\n\nCreate an account.\n\n### Install\n\n```bash\nnpm i\n\n\nnpx init\n```\n\n- Item\n\n  Note.\n\n## Next",
		);
	});
});
