import { describe, expect, it } from "vitest";

import { resolveBenchmarkTargets } from "./targets.js";

describe("resolveBenchmarkTargets", () => {
	it("resolves selected provider mappings to pinned model ids", () => {
		const targets = resolveBenchmarkTargets({
			modelIds: ["deepseek-v4-flash"],
			mappings: ["deepseek", "canopywave"],
		});
		expect(targets.map((target) => target.id)).toEqual([
			"deepseek/deepseek-v4-flash",
			"canopywave/deepseek-v4-flash",
		]);
	});

	it("rejects unknown mappings", () => {
		expect(() =>
			resolveBenchmarkTargets({
				modelIds: ["deepseek-v4-flash"],
				mappings: ["not-a-provider"],
			}),
		).toThrow("No selected model has mapping(s): not-a-provider");
	});
});
