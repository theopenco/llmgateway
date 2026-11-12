import { describe, expect, it } from "vitest";

import {
	batchSupportDescription,
	getMappingCapabilities,
} from "./mapping-capabilities";

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

	it("advertises Batch only when the mapping has batch endpoints", () => {
		expect(
			getMappingCapabilities({
				batchEndpoints: ["/v1/chat/completions", "/v1/responses"],
			}).map(({ label }) => label),
		).toEqual(["Batch"]);
		expect(getMappingCapabilities({ batchEndpoints: [] })).toEqual([]);
		expect(getMappingCapabilities({ batchEndpoints: null })).toEqual([]);
	});
});

describe("batchSupportDescription", () => {
	it("lists the endpoints and states batch pricing", () => {
		const text = batchSupportDescription(["/v1/embeddings"]);
		expect(text).toContain("(/v1/embeddings)");
		expect(text).toContain("same per-token price as live requests");
		expect(text).toContain("No batch discount");
	});
});
