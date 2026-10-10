import { afterEach, describe, expect, test, vi } from "vitest";

import { resolveGlobalStatsRange } from "./global-stats-range";

const originalZone = process.env.TZ;
afterEach(() => {
	vi.useRealTimers();
	process.env.TZ = originalZone;
});

describe("global stats ranges", () => {
	test.each(["America/Los_Angeles", "Asia/Bangkok", "Pacific/Kiritimati"])(
		"defaults to UTC dates in %s",
		(zone) => {
			process.env.TZ = zone;
			vi.useFakeTimers({ toFake: ["Date"] });
			vi.setSystemTime(new Date("2026-01-01T00:30:00Z"));
			expect(resolveGlobalStatsRange(new URLSearchParams())).toEqual({
				allTime: false,
				range: undefined,
				from: "2025-12-26",
				to: "2026-01-01",
			});
		},
	);
	test("keeps last 24 hours relative instead of converting it to calendar days", () => {
		expect(
			resolveGlobalStatsRange(
				new URLSearchParams("range=24h&from=2026-01-01&to=2026-01-01"),
			),
		).toEqual({
			allTime: false,
			range: "24h",
			from: undefined,
			to: undefined,
		});
	});
});
