import { describe, expect, test } from "vitest";

import {
	parseUsageWindow,
	USAGE_WINDOW_OPTIONS,
	usageWindowLabel,
} from "./provider-key-usage-window";

describe("credential usage window", () => {
	test.each([undefined, null, "", "2d"])("defaults %s to all time", (value) => {
		expect(parseUsageWindow(value)).toBe("all");
	});
	test.each(USAGE_WINDOW_OPTIONS)(
		"preserves $value and labels it $label",
		({ value, label }) => {
			expect(parseUsageWindow(value)).toBe(value);
			expect(usageWindowLabel(value)).toBe(label);
		},
	);
});
