import { describe, expect, it } from "vitest";

import { models } from "./models";

describe("Models", () => {
	it("should not have duplicate model IDs", () => {
		const modelIds = models.map((model) => model.id);

		const uniqueModelIds = new Set(modelIds);

		expect(uniqueModelIds.size).toBe(modelIds.length);

		if (uniqueModelIds.size !== modelIds.length) {
			const duplicates = modelIds.filter(
				(id, index) => modelIds.indexOf(id) !== index,
			);
			throw new Error(`Duplicate model IDs found: ${duplicates.join(", ")}`);
		}
	});
});
