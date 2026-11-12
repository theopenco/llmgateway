import { describe, expect, it } from "vitest";

import {
	apiKeyUsageQuery,
	apiKeyUsageSelectionLabel,
	isSameApiKeyUsageQuery,
	parseApiKeyUsageSelection,
} from "./api-key-usage-period";

describe("parseApiKeyUsageSelection", () => {
	it("prefers a valid from/to range over period", () => {
		expect(
			parseApiKeyUsageSelection({
				period: "7d",
				from: "2026-01-01",
				to: "2026-01-31",
			}),
		).toEqual({ period: "custom", from: "2026-01-01", to: "2026-01-31" });
	});

	it("falls back to the period for an invalid or inverted range", () => {
		expect(
			parseApiKeyUsageSelection({
				period: "30d",
				from: "2026-02-30",
				to: "2026-03-01",
			}),
		).toEqual({ period: "30d" });
		expect(
			parseApiKeyUsageSelection({ from: "2026-03-02", to: "2026-03-01" }),
		).toEqual({ period: "all" });
	});
});

describe("apiKeyUsageQuery", () => {
	it("sends the timezone only for custom ranges", () => {
		expect(apiKeyUsageQuery({ period: "24h" }, "Europe/Berlin")).toEqual({
			period: "24h",
		});
		expect(
			apiKeyUsageQuery(
				{ period: "custom", from: "2026-01-01", to: "2026-01-02" },
				"Europe/Berlin",
			),
		).toEqual({
			from: "2026-01-01",
			to: "2026-01-02",
			timezone: "Europe/Berlin",
		});
	});

	it("compares queries by value", () => {
		const custom = { from: "2026-01-01", to: "2026-01-02", timezone: "UTC" };
		expect(isSameApiKeyUsageQuery(custom, { ...custom })).toBe(true);
		expect(
			isSameApiKeyUsageQuery(custom, { ...custom, timezone: "Europe/Berlin" }),
		).toBe(false);
		expect(isSameApiKeyUsageQuery({ period: "all" }, custom)).toBe(false);
	});
});

describe("apiKeyUsageSelectionLabel", () => {
	it("labels presets and custom ranges", () => {
		expect(apiKeyUsageSelectionLabel({ period: "90d" })).toBe("Last 90 days");
		expect(
			apiKeyUsageSelectionLabel({
				period: "custom",
				from: "2026-01-01",
				to: "2026-01-31",
			}),
		).toBe("Jan 1, 2026 – Jan 31, 2026");
	});
});
