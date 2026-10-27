import { describe, expect, it } from "vitest";

import {
	decisionModelAcceptsImages,
	decisionModels,
	initialDecisionModels,
} from "./decision-models";

import type { ApiModel } from "@/lib/fetch-models";

function model(
	id: string,
	output: string[] | null,
	vision: boolean | null = null,
): ApiModel {
	return {
		id,
		output,
		mappings: [{ vision } as ApiModel["mappings"][number]],
	} as ApiModel;
}

describe("decisionModels", () => {
	it("keeps only models whose output includes a decision", () => {
		const offered = decisionModels([
			model("gpt-6-luna-decisions", ["decision"]),
			model("gpt-5", ["text"]),
			model("legacy", null),
		]);
		expect(offered.map((m) => m.id)).toEqual(["gpt-6-luna-decisions"]);
	});
});

describe("initialDecisionModels", () => {
	const offered = [{ id: "a" }, { id: "b" }];

	it("prefers the first saved selection that is still offered", () => {
		expect(initialDecisionModels([null, "zzz", "b,a"], offered)).toEqual([
			"b",
			"a",
		]);
	});

	it("falls back to the first offered model", () => {
		expect(initialDecisionModels(["zzz"], offered)).toEqual(["a"]);
		expect(initialDecisionModels([], [])).toEqual([]);
	});

	it("drops unknown ids from a saved comparison", () => {
		expect(initialDecisionModels(["a,zzz"], offered)).toEqual(["a"]);
	});

	it("deduplicates and caps a user-edited selection", () => {
		const many = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
		expect(initialDecisionModels(["a,a,b"], many)).toEqual(["a", "b"]);
		expect(initialDecisionModels(["a,b,c,d"], many)).toEqual(["a", "b", "c"]);
	});
});

describe("decisionModelAcceptsImages", () => {
	const models = [
		model("vision", ["decision"], true),
		model("text", ["decision"], false),
	];

	it("reads the vision flag of the model's mappings", () => {
		expect(decisionModelAcceptsImages("vision", models)).toBe(true);
		expect(decisionModelAcceptsImages("text", models)).toBe(false);
		expect(decisionModelAcceptsImages("missing", models)).toBe(false);
	});

	it("resolves provider-pinned ids against that provider's mapping", () => {
		const mixed = [
			{
				id: "luna",
				output: ["decision"],
				mappings: [
					{ providerId: "openai", vision: true },
					{ providerId: "azure", vision: false, region: "eu" },
				],
			} as unknown as ApiModel,
		];
		expect(decisionModelAcceptsImages("openai/luna", mixed)).toBe(true);
		expect(decisionModelAcceptsImages("azure/luna", mixed)).toBe(false);
		expect(decisionModelAcceptsImages("azure/luna:eu", mixed)).toBe(false);
		expect(decisionModelAcceptsImages("other/luna", mixed)).toBe(false);
	});
});
