import { describe, expect, it } from "vitest";

import { models, type ModelDefinition } from "./models.js";
import { isModelAllowedByPolicy } from "./providers.js";
import {
	expandVirtualModels,
	getModelAliases,
	getModelDenyRefs,
	getRequestedModelAlias,
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
				const historical = (models as ModelDefinition[]).find(
					(m) => m.id === alias,
				);
				if (historical) {
					expect(
						historical.providers.every(
							(mapping) =>
								mapping.deactivatedAt && mapping.deactivatedAt <= new Date(),
						),
					).toBe(true);
				}
			}
		}
	});
});
describe("requested model aliases", () => {
	it("lists a model's catalogue aliases", () => {
		expect(getModelAliases("jev-1.14.0")).toEqual([
			"jev",
			"jev-latest",
			"jev-preview",
		]);
		expect(getModelAliases("missing-model")).toEqual([]);
	});
	it.each([
		["deepseek-v4.1-flash-latest", "deepseek-v4.1-flash-latest"],
		["tencent/deepseek-v4.1-flash-latest", "deepseek-v4.1-flash-latest"],
		[
			"tencent/deepseek-v4.1-flash-latest:ap-guangzhou",
			"deepseek-v4.1-flash-latest",
		],
		["deepseek-v4.1-flash-1017", undefined],
		["tencent/deepseek-v4.1-flash-1017", undefined],
		[undefined, undefined],
	])("reads the alias named by %s", (input, alias) => {
		expect(getRequestedModelAlias(input, "deepseek-v4.1-flash-1017")).toBe(
			alias,
		);
	});
	it("relates a model, its aliases and listings named after them for deny lists", () => {
		const refs = ["deepseek-v4.1-flash-latest", "deepseek-v4.1-flash-1017"];
		expect(getModelDenyRefs("deepseek-v4.1-flash-1017").sort()).toEqual(
			[...refs].sort(),
		);
		expect(getModelDenyRefs("deepseek-v4.1-flash-latest").sort()).toEqual(
			[...refs].sort(),
		);
		expect(getModelDenyRefs("unknown-model")).toEqual(["unknown-model"]);
	});
	it("ignores an alias of another model", () => {
		expect(
			getRequestedModelAlias("jev-latest", "deepseek-v4.1-flash-1017"),
		).toBeUndefined();
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

it("replaces only retired catalogue rows without changing historical or custom identities", () => {
	const old = {
		id: "deepseek-v4-flash",
		mappings: [{ providerId: "old-carrier" }],
	};
	const snapshot = {
		id: "deepseek-v4-flash-0731",
		mappings: [{ providerId: "snapshot-carrier", inputPrice: "3e-6" }],
	};
	const expanded = expandVirtualModels([old, snapshot]);
	expect(expanded.filter((row) => row.id === old.id)).toEqual([
		{
			...snapshot,
			id: old.id,
			name: old.id,
			aliases: [],
			virtualModelTarget: snapshot.id,
		},
	]);
	expect(expandVirtualModels(expanded)).toEqual(expanded);
	const custom = { ...old, source: "custom" as const };
	expect(expandVirtualModels([custom])).toEqual([custom]);
	expect(models.find((model) => model.id === old.id)?.id).toBe(old.id);
	expect(getVirtualModelTarget(old.id, new Date("2026-11-05"))).toBeUndefined();
	for (const id of [old.id, snapshot.id]) {
		expect(getModelDenyRefs(id).sort()).toEqual([old.id, snapshot.id].sort());
	}
	expect(
		getRequestedModelAlias(`alibaba/${old.id}:singapore`, snapshot.id),
	).toBe(old.id);
});
