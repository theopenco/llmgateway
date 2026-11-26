import { describe, expect, it } from "vitest";

import { parseUsageBreakdown, updateUsageBreakdown } from "./usage-breakdown";

describe("detail usage breakdown", () => {
	it.each(["mapping", "canonical", "provider", "family"])(
		"shares the %s selection between org and project views",
		(view) => {
			const params = updateUsageBreakdown(
				new URLSearchParams("window=7d&mode=api-keys&breakdown=user"),
				view,
			);
			for (const scope of ["organization", "project"] as const) {
				const parsed =
					scope === "organization"
						? parseUsageBreakdown(params, scope)
						: parseUsageBreakdown(params, scope);
				expect(parsed).toEqual({ groupBy: "model", modelView: view });
			}
			expect(params.get("window")).toBe("7d");
			expect(params.get("mode")).toBe("api-keys");
		},
	);
	it("preserves legacy links and rejects dimensions outside their scope", () => {
		expect(
			parseUsageBreakdown(
				new URLSearchParams("modelView=canonical"),
				"organization",
			),
		).toEqual({ groupBy: "model", modelView: "canonical" });
		expect(
			parseUsageBreakdown(
				new URLSearchParams("breakdown=source&modelView=bad"),
				"organization",
			),
		).toEqual({ groupBy: "model", modelView: "mapping" });
		expect(
			parseUsageBreakdown(new URLSearchParams("breakdown=project"), "project")
				.groupBy,
		).toBe("model");
	});
	it("preserves model view and other filters while switching dimensions", () => {
		const original = new URLSearchParams(
			"window=30d&mode=credits&modelView=family",
		);
		const next = updateUsageBreakdown(original, "project");
		expect(parseUsageBreakdown(next, "organization")).toEqual({
			groupBy: "project",
			modelView: "family",
		});
		expect(original.has("breakdown")).toBe(false);
		expect(updateUsageBreakdown(next, "mapping").has("modelView")).toBe(false);
	});
});
