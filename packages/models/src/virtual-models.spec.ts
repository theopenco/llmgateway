import { describe, expect, it } from "vitest";

import { models, type ModelDefinition } from "./models.js";
import { isModelAllowedByPolicy } from "./providers.js";
import {
	expandVirtualModels,
	getVirtualModelTarget,
} from "./virtual-models.js";

describe("virtual models", () => {
	it.each([
		["deepseek-v4.1-flash-latest", "deepseek-v4.1-flash-1017"],
		["jev", "jev-1.14.0"],
		["jev-latest", "jev-1.14.0"],
		["jev-preview", "jev-1.14.0"],
	])("resolves %s to its current cut", (alias, target) => {
		expect(getVirtualModelTarget(alias)?.id).toBe(target);
	});
	it("does not treat fixed aliases or canonical IDs as virtual", () => {
		expect(getVirtualModelTarget("deepseek-v4.1-flash")).toBeUndefined();
		expect(getVirtualModelTarget("jev-1.14.0")).toBeUndefined();
		expect(getVirtualModelTarget("missing-latest")).toBeUndefined();
	});
	it("inherits current prices, capabilities and eligibility without duplicates", () => {
		const mappings = [
			{ inputPrice: "0.042e-6", blockedReasons: ["Not eligible"] },
		];
		const cut = { id: "jev-1.14.0", name: "Jev 1.14", mappings };
		const expanded = expandVirtualModels([cut]);
		expect(expanded).toHaveLength(4);
		expect(expanded.find((m) => m.id === "jev-latest")).toMatchObject({
			virtualModelTarget: cut.id,
			mappings,
		});
		expect(expandVirtualModels(expanded)).toEqual(expanded);
		expect(expandVirtualModels([{ id: "unknown" }])).toEqual([
			{ id: "unknown" },
		]);
		expect(expandVirtualModels([])).toEqual([]);
	});
	it("keeps every virtual ID a routable catalogue alias", () => {
		for (const model of models as ModelDefinition[]) {
			if (!model.aliasesAreVirtual) {
				continue;
			}
			for (const alias of model.aliases ?? []) {
				expect(getVirtualModelTarget(alias)).toBe(model);
				expect(models.some((m) => m.id === alias)).toBe(false);
			}
		}
	});
});
it("does not expand organization-defined custom models", () => {
	const custom = { id: "jev-1.14.0", source: "custom" as const };
	expect(expandVirtualModels([custom])).toEqual([custom]);
});
it("keeps virtual policy checks tied to the current canonical cut", () => {
	for (const row of expandVirtualModels([{ id: "jev-1.14.0" }])) {
		const refs = [row.virtualModelTarget ?? row.id];
		expect(
			isModelAllowedByPolicy(refs, {
				enabled: true,
				blockedModels: ["jev-1.14.0"],
			}),
		).toBe(false);
		expect(
			isModelAllowedByPolicy(refs, {
				enabled: true,
				allowedModels: ["jev-1.14.0"],
			}),
		).toBe(true);
	}
});
