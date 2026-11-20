import { describe, expect, it } from "vitest";

import { extractHowToSteps } from "./howto";

describe("extractHowToSteps", () => {
	it("pairs numbered headings with their first paragraph", () => {
		const steps = extractHowToSteps(
			[
				"## Migration Steps",
				"",
				"### 1. Get Your API Key",
				"",
				"Sign up and create a [key](https://example.com).",
				"",
				"More detail.",
				"",
				"### 2. Update Your Code",
				"",
				"```ts",
				"const ignored = true;",
				"```",
				"",
				"Change the base URL.",
				"",
				"## Next",
			].join("\n"),
		);
		expect(steps).toEqual([
			{ name: "Get Your API Key", text: "Sign up and create a key." },
			{ name: "Update Your Code", text: "Change the base URL." },
		]);
	});

	it("falls back to the heading when a step has no prose", () => {
		expect(extractHowToSteps("### 1. Deploy\n\n### 2. Verify")).toEqual([
			{ name: "Deploy", text: "Deploy" },
			{ name: "Verify", text: "Verify" },
		]);
	});

	it("ignores unnumbered headings", () => {
		expect(extractHowToSteps("### Overview\n\nText.")).toEqual([]);
	});
});
