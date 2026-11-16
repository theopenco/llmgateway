import { describe, expect, test } from "vitest";

import { getPlans } from "@/app/dashboard/plans";

import { resolveOffer, type CancelContext } from "./cancel-offers";

const plans = getPlans({ lite: 58, pro: 158, max: 358 });

function context(overrides: Partial<CancelContext>): CancelContext {
	return {
		tier: "pro",
		pendingTier: null,
		creditsUsed: 0,
		creditsLimit: 158,
		renewalRollover: 0,
		paygEnabled: false,
		plans,
		docsUrl: "https://docs.example.test",
		discordUrl: "https://discord.example.test",
		...overrides,
	};
}

describe("offer for a price or usage reason", () => {
	test("a light month on a plan with a smaller tier gets the downgrade", () => {
		expect(
			resolveOffer(
				"too_expensive",
				context({ creditsUsed: 50, renewalRollover: 79 }),
			),
		).toEqual({ kind: "downgrade", tier: "lite" });
	});

	test("carried-over allowance does not make a heavy month look light", () => {
		// 90 of 237 is under 40% of the cycle but over half of the plan's own 158,
		// more than the smaller plan includes.
		expect(
			resolveOffer(
				"too_expensive",
				context({ creditsUsed: 90, creditsLimit: 237, renewalRollover: 79 }),
			),
		).toEqual({ kind: "rollover", amount: 79, unused: 147, capped: true });
	});

	test("the lowest tier gets the carry-over, flagged when the cap cuts it", () => {
		expect(
			resolveOffer(
				"not_using_enough",
				context({
					tier: "lite",
					creditsUsed: 11.5,
					creditsLimit: 58,
					renewalRollover: 29,
				}),
			),
		).toEqual({ kind: "rollover", amount: 29, unused: 46.5, capped: true });
	});

	test("a carry-over under the cap is not flagged", () => {
		expect(
			resolveOffer(
				"just_testing",
				context({ creditsUsed: 101.12, renewalRollover: 56.88 }),
			),
		).toMatchObject({ kind: "rollover", amount: 56.88, capped: false });
	});

	test("a carry-over too small to matter shows nothing", () => {
		expect(
			resolveOffer(
				"too_expensive",
				context({ creditsUsed: 156.5, renewalRollover: 1.5 }),
			),
		).toBeNull();
	});

	test("a scheduled change blocks the downgrade and sets the floor", () => {
		// The floor follows the plan that renews: 6 is under a tenth of Pro's
		// allowance but not of Lite's.
		const scheduled = context({
			pendingTier: "lite",
			creditsUsed: 20,
			renewalRollover: 29,
		});
		expect(resolveOffer("too_expensive", scheduled)).toMatchObject({
			kind: "rollover",
			amount: 29,
		});
		expect(
			resolveOffer("too_expensive", {
				...scheduled,
				creditsUsed: 152,
				renewalRollover: 6,
			}),
		).toMatchObject({ kind: "rollover", amount: 6 });
		expect(
			resolveOffer(
				"too_expensive",
				context({ creditsUsed: 152, renewalRollover: 6 }),
			),
		).toBeNull();
	});
});

test("running out of allowance still offers the next plan", () => {
	expect(
		resolveOffer(
			"allowance_too_small",
			context({ creditsUsed: 150, renewalRollover: 8 }),
		),
	).toEqual({ kind: "upgrade", tier: "max" });
});
