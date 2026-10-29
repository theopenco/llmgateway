import { describe, expect, test } from "vitest";

import { models, type ModelDefinition } from "@llmgateway/models";

import { curatedCategoryModelIds } from "./model-category-filters";

const catalogue = new Map(
	(models as readonly ModelDefinition[]).map((model) => [model.id, model]),
);

// Mirrors the directory's default visibility (status-filters.ts): a mapping
// that is already deprecated or deactivated never renders, so a curated id
// whose mappings are all in that state is dead weight on the page.
function liveMappings(model: ModelDefinition, now: number) {
	return model.providers.filter(
		(mapping) =>
			!(mapping.deprecatedAt && mapping.deprecatedAt.getTime() <= now) &&
			!(mapping.deactivatedAt && mapping.deactivatedAt.getTime() <= now),
	);
}

describe("curated category model ids", () => {
	const now = Date.now();

	for (const [category, ids] of Object.entries(curatedCategoryModelIds)) {
		test(`${category} lists only catalogue models with a live mapping`, () => {
			const missing = Array.from(ids).filter((id) => !catalogue.has(id));
			expect(missing, "ids not in the catalogue").toEqual([]);
			const dead = Array.from(ids).filter(
				(id) => liveMappings(catalogue.get(id)!, now).length === 0,
			);
			expect(dead, "ids with no live provider mapping").toEqual([]);
		});
	}

	// The security pages promise tool calling in their copy: agents drive
	// REA, Ghidra, Hopper, scanners and sandboxes through MCP.
	for (const category of ["cyber-security", "reverse-engineering"] as const) {
		test(`${category} models all support tool calling on a live mapping`, () => {
			const withoutTools = Array.from(curatedCategoryModelIds[category]).filter(
				(id) =>
					!liveMappings(catalogue.get(id)!, now).some(
						(mapping) => mapping.tools,
					),
			);
			expect(withoutTools, "ids with no live tool-calling mapping").toEqual([]);
		});
	}
});
