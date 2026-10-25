import { describe, expect, test } from "vitest";

import { models, type ModelDefinition } from "@llmgateway/models";

import { curatedCategoryModelIds } from "./model-category-filters";

const catalogue = new Map(
	(models as readonly ModelDefinition[]).map((model) => [model.id, model]),
);

function liveMappings(model: ModelDefinition, now: number) {
	return model.providers.filter(
		(mapping) =>
			!(mapping.deactivatedAt && mapping.deactivatedAt.getTime() <= now),
	);
}

describe("curated category model ids", () => {
	const now = Date.now();

	for (const [category, ids] of Object.entries(curatedCategoryModelIds)) {
		test(`${category} lists only catalogue models with a live mapping`, () => {
			for (const id of Array.from(ids)) {
				const model = catalogue.get(id);
				expect(model, `${id} is not in the catalogue`).toBeDefined();
				expect(
					liveMappings(model!, now).length,
					`${id} has no live provider mapping`,
				).toBeGreaterThan(0);
			}
		});
	}

	// The security pages promise tool calling in their copy: agents drive
	// REA, Ghidra, Hopper, scanners and sandboxes through MCP.
	for (const category of ["cyber-security", "reverse-engineering"] as const) {
		test(`${category} models all support tool calling on a live mapping`, () => {
			for (const id of Array.from(curatedCategoryModelIds[category])) {
				const model = catalogue.get(id)!;
				expect(
					liveMappings(model, now).some((mapping) => mapping.tools),
					`${id} has no live mapping with tools`,
				).toBe(true);
			}
		});
	}
});
