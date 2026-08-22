import { describe, expect, it } from "vitest";

import { formatPeakPricingSchedule } from "./pricing-schedule";

describe("formatPeakPricingSchedule", () => {
	it("formats DeepSeek weekday windows in Beijing time", () => {
		expect(
			formatPeakPricingSchedule({
				peak: {
					inputPrice: "0.44e-6",
					outputPrice: "1.32e-6",
					cachedInputPrice: "0.014e-6",
				},
				offPeak: {
					inputPrice: "0.22e-6",
					outputPrice: "0.66e-6",
					cachedInputPrice: "0.007e-6",
				},
				hoursUtc: [
					[1, 4],
					[6, 10],
				],
				offPeakDays: {
					daysOfWeek: [0, 6],
					utcOffsetMinutes: 480,
					timeZoneLabel: "Beijing time",
				},
			}),
		).toEqual({
			peakDays: "Monday–Friday",
			offPeakDays: "Saturday and Sunday",
			peakHours: "09:00–12:00 and 14:00–18:00",
			timeZoneLabel: "Beijing time",
		});
	});
});
