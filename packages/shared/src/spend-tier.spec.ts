import { describe, expect, test } from "vitest";

import {
	getOrgContentFilterTier,
	resolveContentFilterTierOverride,
} from "./spend-tier.js";

const NOW = Date.parse("2026-09-13T00:00:00Z");
const DAY_MS = 86_400_000;

function daysAgo(days: number): Date {
	return new Date(NOW - Math.round(days * DAY_MS));
}

describe("getOrgContentFilterTier", () => {
	test("follows the trust tier ladder by default", () => {
		expect(getOrgContentFilterTier({ createdAt: daysAgo(0) }, 0, NOW)).toEqual({
			tier: 0,
			overridden: false,
			level: "strict",
		});
		expect(getOrgContentFilterTier({ createdAt: daysAgo(31) }, 0, NOW)).toEqual(
			{ tier: 2, overridden: false, level: "strict" },
		);
		expect(getOrgContentFilterTier({ createdAt: daysAgo(60) }, 0, NOW)).toEqual(
			{ tier: 3, overridden: false, level: "lenient" },
		);
	});

	test("a trust tier pin flows through", () => {
		expect(
			getOrgContentFilterTier(
				{ createdAt: daysAgo(0), trustTierOverride: 4 },
				0,
				NOW,
			),
		).toEqual({ tier: 4, overridden: false, level: "lenient" });
	});

	test("a content filter pin wins over the ladder and the trust pin", () => {
		expect(
			getOrgContentFilterTier(
				{
					createdAt: daysAgo(365),
					trustTierOverride: 4,
					contentFilterTierOverride: 1,
				},
				10_000,
				NOW,
			),
		).toEqual({ tier: 1, overridden: true, level: "strict" });
		expect(
			getOrgContentFilterTier(
				{ createdAt: daysAgo(0), contentFilterTierOverride: 3 },
				0,
				NOW,
			),
		).toEqual({ tier: 3, overridden: true, level: "lenient" });
	});

	test("clamps the pin to the ladder", () => {
		expect(
			resolveContentFilterTierOverride({ contentFilterTierOverride: 9 }),
		).toBe(4);
		expect(
			resolveContentFilterTierOverride({ contentFilterTierOverride: -2 }),
		).toBe(0);
		expect(
			resolveContentFilterTierOverride({ contentFilterTierOverride: null }),
		).toBeNull();
	});
});
