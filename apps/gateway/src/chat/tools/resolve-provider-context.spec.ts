import { describe, expect, it } from "vitest";

import {
	formatTimeUntilReset,
	formatUsedModelForDisplay,
} from "./resolve-provider-context.js";

describe("formatUsedModelForDisplay", () => {
	it("uses the provider id for built-in providers", () => {
		expect(formatUsedModelForDisplay("openai", "gpt-5.4-nano")).toBe(
			"openai/gpt-5.4-nano",
		);
	});

	it("uses the custom provider name for custom providers", () => {
		expect(formatUsedModelForDisplay("custom", "gpt-5.4-nano", "stuff")).toBe(
			"stuff/gpt-5.4-nano",
		);
	});

	it("appends the region suffix when provided", () => {
		expect(
			formatUsedModelForDisplay("alibaba", "glm-4.6", undefined, "cn-beijing"),
		).toBe("alibaba/glm-4.6:cn-beijing");
	});

	it("omits the region suffix when undefined", () => {
		expect(
			formatUsedModelForDisplay("alibaba", "glm-4.6", undefined, undefined),
		).toBe("alibaba/glm-4.6");
	});
});

describe("formatTimeUntilReset", () => {
	const HOUR = 60 * 60 * 1000;
	const DAY = 24 * HOUR;

	it("formats days and hours", () => {
		// 147h = 6 days and 3 hours
		expect(formatTimeUntilReset(147 * HOUR)).toBe("6 days and 3 hours");
	});

	it("rounds partial hours up", () => {
		expect(formatTimeUntilReset(146.5 * HOUR)).toBe("6 days and 3 hours");
	});

	it("drops the hours component when it is zero", () => {
		expect(formatTimeUntilReset(7 * DAY)).toBe("7 days");
	});

	it("drops the days component when under a day", () => {
		expect(formatTimeUntilReset(5 * HOUR)).toBe("5 hours");
	});

	it("uses singular units", () => {
		expect(formatTimeUntilReset(DAY + HOUR)).toBe("1 day and 1 hour");
	});

	it("reports less than an hour for sub-hour durations", () => {
		expect(formatTimeUntilReset(30 * 60 * 1000)).toBe("less than an hour");
		expect(formatTimeUntilReset(0)).toBe("less than an hour");
	});
});
