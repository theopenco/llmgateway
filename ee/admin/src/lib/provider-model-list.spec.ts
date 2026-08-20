import { describe, expect, test } from "vitest";

import { parseProviderModelList } from "./provider-model-list";

const availableIds = ["gpt-5.2", "gpt-5.2-mini", "text-embedding-3-small"];

describe("parseProviderModelList", () => {
	test("parses common list formats and removes duplicates", () => {
		expect(
			parseProviderModelList(
				'gpt-5.2, openai/gpt-5.2-mini\n"text-embedding-3-small"; gpt-5.2',
				availableIds,
			),
		).toEqual({
			modelIds: ["gpt-5.2", "gpt-5.2-mini", "text-embedding-3-small"],
			unknownIds: [],
		});
	});

	test("accepts a JSON-style array", () => {
		expect(
			parseProviderModelList('["gpt-5.2", "gpt-5.2-mini"]', availableIds),
		).toEqual({
			modelIds: ["gpt-5.2", "gpt-5.2-mini"],
			unknownIds: [],
		});
	});

	test("reports model ids outside the provider catalog", () => {
		expect(
			parseProviderModelList(
				"gpt-5.2 unknown-model openai/another-model unknown-model",
				availableIds,
			),
		).toEqual({
			modelIds: ["gpt-5.2"],
			unknownIds: ["unknown-model", "openai/another-model"],
		});
	});
});
