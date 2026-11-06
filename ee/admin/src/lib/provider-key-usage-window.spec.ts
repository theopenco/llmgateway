import { describe, expect, test } from "vitest";

import {
	parseUsageWindow,
	USAGE_WINDOW_OPTIONS,
	usageWindowLabel,
	resolveCredentialPeriod,
} from "./provider-key-usage-window";

describe("credential usage window", () => {
	test.each([undefined, null, "", "2d"])("defaults %s to 7d", (value) => {
		expect(parseUsageWindow(value)).toBe("7d");
	});
	test.each(USAGE_WINDOW_OPTIONS)(
		"preserves $value and labels it $label",
		({ value, label }) => {
			expect(parseUsageWindow(value)).toBe(value);
			expect(usageWindowLabel(value)).toBe(label);
		},
	);
});

test.each([
	[{}, "7d"],
	[{ errors: "4h" }, "4h"],
	[{ usage: "30d", errors: "1d" }, "30d"],
	[{ period: "7d", usage: "30d", errors: "1d" }, "7d"],
	[{ period: "invalid" }, "7d"],
])("resolves one period from %j", (params, expected) => {
	expect(resolveCredentialPeriod(params)).toBe(expected);
});
