import { afterEach, describe, expect, it, vi } from "vitest";

import {
	addApiKeyPeriodDuration,
	apiKeyPeriodDurationMaxValues,
	getApiKeyCurrentPeriodState,
	isValidApiKeyPeriodDuration,
} from "./api-key-period-limit.js";

describe("api-key-period-limit", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it.each([
		["2026-10-25T00:30:00.000Z", 1, "2026-10-25T01:30:00.000Z"],
		["2026-03-29T00:30:00.000Z", 2, "2026-03-29T02:30:00.000Z"],
	])("keeps hourly durations exact across DST from %s", (start, hours, end) => {
		vi.stubEnv("TZ", "Europe/Stockholm");
		const startedAt = new Date(start);
		const next = addApiKeyPeriodDuration(startedAt, hours, "hour");

		expect(next.toISOString()).toBe(end);
		expect(startedAt.toISOString()).toBe(start);
	});

	it("validates supported duration ranges", () => {
		expect(isValidApiKeyPeriodDuration(1, "hour")).toBe(true);
		expect(
			isValidApiKeyPeriodDuration(apiKeyPeriodDurationMaxValues.month, "month"),
		).toBe(true);
		expect(isValidApiKeyPeriodDuration(0, "hour")).toBe(false);
		expect(
			isValidApiKeyPeriodDuration(
				apiKeyPeriodDurationMaxValues.week + 1,
				"week",
			),
		).toBe(false);
	});

	it("adds month durations using calendar months", () => {
		const startedAt = new Date("2026-01-31T00:00:00.000Z");

		const next = addApiKeyPeriodDuration(startedAt, 1, "month");

		expect(next.toISOString()).toBe("2026-02-28T00:00:00.000Z");
	});

	it("returns zero usage when no active period has started", () => {
		const state = getApiKeyCurrentPeriodState({
			periodUsageLimit: "10",
			periodUsageDurationValue: 1,
			periodUsageDurationUnit: "day",
			currentPeriodUsage: "4.2",
			currentPeriodStartedAt: null,
		});

		expect(state).toEqual({
			isConfigured: true,
			isExpired: false,
			usage: "0",
			startedAt: null,
			resetAt: null,
		});
	});

	it("resets expired periods in memory", () => {
		const state = getApiKeyCurrentPeriodState(
			{
				periodUsageLimit: "10",
				periodUsageDurationValue: 1,
				periodUsageDurationUnit: "hour",
				currentPeriodUsage: "9.5",
				currentPeriodStartedAt: new Date("2026-03-29T09:00:00.000Z"),
			},
			new Date("2026-03-29T10:00:00.000Z"),
		);

		expect(state).toEqual({
			isConfigured: true,
			isExpired: true,
			usage: "0",
			startedAt: null,
			resetAt: null,
		});
	});

	it("returns the active period usage and reset time", () => {
		const state = getApiKeyCurrentPeriodState(
			{
				periodUsageLimit: "10",
				periodUsageDurationValue: 2,
				periodUsageDurationUnit: "day",
				currentPeriodUsage: "3.25",
				currentPeriodStartedAt: new Date("2026-03-29T09:00:00.000Z"),
			},
			new Date("2026-03-30T09:00:00.000Z"),
		);

		expect(state.isConfigured).toBe(true);
		expect(state.isExpired).toBe(false);
		expect(state.usage).toBe("3.25");
		expect(state.startedAt?.toISOString()).toBe("2026-03-29T09:00:00.000Z");
		expect(state.resetAt?.toISOString()).toBe("2026-03-31T09:00:00.000Z");
	});
});
