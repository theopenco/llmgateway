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
});
