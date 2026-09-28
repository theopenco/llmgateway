import { describe, expect, it } from "vitest";

import {
	decideSmartRoutingRecheck,
	decideSmartRoutingSwitch,
	estimateRemainingTurns,
	estimateSmartRoutingEconomics,
	type SmartRoutingPick,
} from "./smart-routing-policy.js";

import type { RequestClassification } from "./smart-routing.js";

const STRONG = {
	inputPrice: "3e-6",
	cachedInputPrice: "0.3e-6",
	cacheWriteInputPrice: "3.75e-6",
	outputPrice: "15e-6",
};
const CHEAP = {
	inputPrice: "1e-6",
	cachedInputPrice: "0.1e-6",
	cacheWriteInputPrice: "1.25e-6",
	outputPrice: "5e-6",
};
const WORKLOAD = {
	promptTokensPerTurn: 100_000,
	outputTokensPerTurn: 2_000,
	cacheHitRate: 0.9,
	contextTokens: 50_000,
};

describe("decideSmartRoutingRecheck", () => {
	it("never rechecks mid-turn", () => {
		expect(
			decideSmartRoutingRecheck({
				turnBoundary: false,
				turnsSinceCheck: 99,
				idleSeconds: 9999,
				cacheMaxIdleSeconds: 300,
			}),
		).toBeNull();
	});

	it("rechecks once a known cache lifetime has passed", () => {
		expect(
			decideSmartRoutingRecheck({
				turnBoundary: true,
				turnsSinceCheck: 1,
				idleSeconds: 301,
				cacheMaxIdleSeconds: 300,
			}),
		).toBe("cache-expired");
	});

	it("does not treat an unknown cache lifetime as expiry", () => {
		expect(
			decideSmartRoutingRecheck({
				turnBoundary: true,
				turnsSinceCheck: 1,
				idleSeconds: 86_400,
			}),
		).toBeNull();
	});

	it("scans every few turns", () => {
		expect(
			decideSmartRoutingRecheck({ turnBoundary: true, turnsSinceCheck: 3 }),
		).toBeNull();
		expect(
			decideSmartRoutingRecheck({ turnBoundary: true, turnsSinceCheck: 4 }),
		).toBe("scan");
	});
});

describe("estimateSmartRoutingEconomics", () => {
	it("charges the switch a check and a cache rebuild", () => {
		const economics = estimateSmartRoutingEconomics({
			current: { prices: STRONG },
			proposed: { prices: CHEAP },
			workload: WORKLOAD,
			remainingTurns: 2,
			currentCacheWarm: true,
			switchBreaksCache: true,
			checkCostUsd: 0.0001,
		});

		expect(economics?.stayUsd).toBeCloseTo(0.174, 6);
		expect(economics?.switchUsd).toBeCloseTo(0.058 + 0.053 + 0.0001, 6);
	});

	it("charges staying the rebuild when its cache is already gone", () => {
		const economics = estimateSmartRoutingEconomics({
			current: { prices: STRONG },
			proposed: { prices: CHEAP },
			workload: WORKLOAD,
			remainingTurns: 2,
			currentCacheWarm: false,
			switchBreaksCache: true,
			checkCostUsd: 0,
		});

		expect(economics?.stayUsd).toBeCloseTo(0.174 + 0.159, 6);
	});

	it("skips the rebuild for an effort change that keeps the cache", () => {
		const economics = estimateSmartRoutingEconomics({
			current: { prices: STRONG, effort: "high" },
			proposed: { prices: STRONG, effort: "low" },
			workload: WORKLOAD,
			remainingTurns: 1,
			currentCacheWarm: true,
			switchBreaksCache: false,
			checkCostUsd: 0,
		});

		// Low effort is estimated at a quarter of high effort's output.
		expect(economics?.stayUsd).toBeCloseTo(0.087, 6);
		expect(economics?.switchUsd).toBeCloseTo(0.057 + 0.0075, 6);
	});

	it("counts the rebuild for an effort change that breaks the cache", () => {
		const economics = estimateSmartRoutingEconomics({
			current: { prices: STRONG, effort: "high" },
			proposed: { prices: STRONG, effort: "low" },
			workload: WORKLOAD,
			remainingTurns: 1,
			currentCacheWarm: true,
			switchBreaksCache: true,
			checkCostUsd: 0,
		});

		expect(economics?.switchUsd).toBeCloseTo(0.057 + 0.0075 + 0.159, 6);
	});

	it("returns null instead of treating a missing price as free", () => {
		expect(
			estimateSmartRoutingEconomics({
				current: { prices: STRONG },
				proposed: { prices: { inputPrice: "1e-6" } },
				workload: WORKLOAD,
				remainingTurns: 2,
				currentCacheWarm: true,
				switchBreaksCache: true,
				checkCostUsd: 0,
			}),
		).toBeNull();
	});
});

describe("estimateRemainingTurns", () => {
	it("assumes as many turns remain as have passed, within bounds", () => {
		expect(estimateRemainingTurns(0)).toBe(1);
		expect(estimateRemainingTurns(4)).toBe(4);
		expect(estimateRemainingTurns(50)).toBe(10);
	});
});

describe("decideSmartRoutingSwitch", () => {
	const top: SmartRoutingPick = {
		modelId: "top",
		band: "high",
		effort: "high",
	};
	const cheap: SmartRoutingPick = {
		modelId: "cheap",
		band: "low",
		effort: "low",
	};

	function verdict(
		overrides: Partial<RequestClassification>,
	): RequestClassification {
		return {
			difficulty: "low",
			workChange: "easier",
			workChangeConfidence: 0.9,
			...overrides,
		};
	}

	it("keeps an unchanged choice", () => {
		expect(
			decideSmartRoutingSwitch({
				current: top,
				proposed: top,
				classification: verdict({}),
				turnsSinceSwitch: 10,
				economics: null,
			}),
		).toEqual({ apply: false, reason: "unchanged" });
	});

	it("applies the brief's example: 40¢ stay vs 20¢ + 5¢ switch", () => {
		expect(
			decideSmartRoutingSwitch({
				current: top,
				proposed: cheap,
				classification: verdict({}),
				turnsSinceSwitch: 10,
				economics: { stayUsd: 0.4, switchUsd: 0.25 },
			}),
		).toEqual({ apply: true, direction: "downgrade", reason: "savings" });
	});

	it("keeps the choice when savings do not clear the margin", () => {
		expect(
			decideSmartRoutingSwitch({
				current: top,
				proposed: cheap,
				classification: verdict({}),
				turnsSinceSwitch: 10,
				economics: { stayUsd: 0.4, switchUsd: 0.32 },
			}).reason,
		).toBe("insufficient-savings");
	});

	it("skips a cost-driven switch when prices are unknown", () => {
		expect(
			decideSmartRoutingSwitch({
				current: top,
				proposed: cheap,
				classification: verdict({}),
				turnsSinceSwitch: 10,
				economics: null,
			}).reason,
		).toBe("unknown-prices");
	});

	it("waits out the cooldown before a cost-driven switch", () => {
		expect(
			decideSmartRoutingSwitch({
				current: top,
				proposed: cheap,
				classification: verdict({}),
				turnsSinceSwitch: 1,
				economics: { stayUsd: 1, switchUsd: 0.1 },
			}).reason,
		).toBe("cooldown");
	});

	it("upgrades for harder work without a cost check or cooldown", () => {
		expect(
			decideSmartRoutingSwitch({
				current: cheap,
				proposed: top,
				classification: verdict({ difficulty: "high", workChange: "harder" }),
				turnsSinceSwitch: 0,
				economics: null,
			}),
		).toEqual({ apply: true, direction: "upgrade", reason: "harder-work" });
	});

	it("keeps the choice when the work is unchanged, unclear, or unconfident", () => {
		for (const [overrides, reason] of [
			[{ workChange: "same" }, "work-unchanged"],
			[{ workChange: "unclear" }, "work-unclear"],
			[{ workChange: undefined }, "work-unclear"],
			[{ workChangeConfidence: 0.3 }, "low-confidence"],
		] as const) {
			expect(
				decideSmartRoutingSwitch({
					current: top,
					proposed: cheap,
					classification: verdict(overrides),
					turnsSinceSwitch: 10,
					economics: { stayUsd: 1, switchUsd: 0.1 },
				}).reason,
			).toBe(reason);
		}
	});

	it("never moves below the band the work needs", () => {
		expect(
			decideSmartRoutingSwitch({
				current: top,
				proposed: cheap,
				classification: verdict({ difficulty: "medium" }),
				turnsSinceSwitch: 10,
				economics: { stayUsd: 1, switchUsd: 0.1 },
			}).reason,
		).toBe("below-required-band");
	});

	it("does not downgrade on harder work", () => {
		expect(
			decideSmartRoutingSwitch({
				current: top,
				proposed: cheap,
				classification: verdict({ workChange: "harder" }),
				turnsSinceSwitch: 10,
				economics: { stayUsd: 1, switchUsd: 0.1 },
			}).reason,
		).toBe("work-unclear");
	});
});
