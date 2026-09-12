import { describe, expect, it } from "vitest";

import { capabilityCases } from "./capability.js";
import { getBuiltInProfile } from "./index.js";

describe("capability profiles", () => {
	it("uses the same generated instance for robustness variants", () => {
		const canonical = capabilityCases.find(
			(benchmarkCase) => benchmarkCase.id === "seeded_shortest_path",
		);
		const paraphrase = capabilityCases.find(
			(benchmarkCase) => benchmarkCase.id === "seeded_shortest_path_paraphrase",
		);
		expect(canonical?.seedGroup).toBe("seeded_shortest_path");
		expect(paraphrase).toMatchObject({
			seedGroup: "seeded_shortest_path",
			variantOf: "seeded_shortest_path",
		});
	});

	it("exposes bounded smoke, standard, and load profiles", () => {
		for (const name of ["smoke", "standard", "load"] as const) {
			const profile = getBuiltInProfile(name);
			expect(profile.cases.length).toBeGreaterThan(0);
			expect(profile.defaults.budgetMs).toBe(60_000);
		}
		expect(() => getBuiltInProfile("unknown")).toThrow("Unknown profile");
	});
});
