import { describe, expect, it } from "vitest";

import { getMappingCapabilities } from "./mapping-capabilities";

describe("getMappingCapabilities", () => {
	it("uses provider mapping metadata instead of model-wide metadata", () => {
		expect(
			getMappingCapabilities({
				streaming: true,
				vision: true,
				tools: true,
				reasoning: true,
				jsonOutput: true,
				jsonOutputSchema: true,
				webSearch: true,
			}).map(({ label }) => label),
		).toEqual([
			"Streaming",
			"Vision",
			"Tools",
			"Reasoning",
			"JSON output",
			"Structured JSON",
			"Web search",
		]);
	});

	it("does not advertise capabilities disabled on a mapping", () => {
		expect(
			getMappingCapabilities({ streaming: false, vision: null, tools: false }),
		).toEqual([]);
	});
});
