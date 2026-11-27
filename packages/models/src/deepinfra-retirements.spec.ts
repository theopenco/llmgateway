import { describe, expect, it } from "vitest";

import { ibmModels } from "./models/ibm.js";
import { isLiveMapping } from "./providers.js";

import type { ModelDefinition } from "./models.js";

describe("DeepInfra December 2026 retirements", () => {
	it("retires deepinfra/granite-4.2-8b on 2026-12-03", () => {
		const deactivatedAt = new Date("2026-12-03");
		const mapping = (ibmModels as readonly ModelDefinition[])
			.find((model) => model.id === "granite-4.2-8b")
			?.providers.find((entry) => entry.providerId === "deepinfra");

		expect(mapping).toBeDefined();
		expect(mapping?.deprecatedAt).toBeUndefined();
		expect(mapping?.deactivatedAt).toEqual(deactivatedAt);
		expect(isLiveMapping(mapping!, new Date(deactivatedAt.getTime() - 1))).toBe(
			true,
		);
		expect(isLiveMapping(mapping!, deactivatedAt)).toBe(false);
	});
});
