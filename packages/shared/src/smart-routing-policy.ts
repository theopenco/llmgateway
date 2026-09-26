import { Decimal } from "decimal.js";

import {
	SMART_ROUTING_DIFFICULTIES,
	SMART_ROUTING_EFFORTS,
	type RequestClassification,
	type SmartRoutingDifficulty,
	type SmartRoutingEffort,
} from "./smart-routing.js";

/**
 * When a sticky smart-routing session re-evaluates its model and effort, and
 * how eagerly it acts on the result. Starting values: tune them against
 * recorded coding sessions rather than treating them as fixed.
 */
export const SMART_ROUTING_POLICY = {
	/** User turns between work scans. */
	scanEveryTurns: 4,
	/** Classifier confidence in a work change required before acting on it. */
	minConfidence: 0.6,
	/** User turns a cost-driven switch waits after the previous switch. */
	costSwitchCooldownTurns: 3,
	/** Share of the stay cost a cost-driven switch must save. */
	savingsMargin: 0.25,
	/** USD a cost-driven switch must save at minimum. */
	minSavingsUsd: 0.005,
	/** Cap on the remaining-turn estimate. */
	maxRemainingTurns: 10,
};

export type SmartRoutingPolicy = typeof SMART_ROUTING_POLICY;

/**
 * Relative output volume (answer plus reasoning) per effort tier, used to
 * scale a session's observed output when estimating another effort.
 */
export const SMART_ROUTING_EFFORT_OUTPUT_WEIGHT: Record<
	SmartRoutingEffort,
	number
> = {
	low: 0.5,
	medium: 1,
	high: 2,
};

export type SmartRoutingRecheckTrigger = "cache-expired" | "scan";

/**
 * Whether this request re-evaluates the session's choice. Only a user turn
 * can: a request that continues a turn (tool results, mid-turn steering)
 * always keeps the current choice. Expiry needs a known cache lifetime — an
 * unknown lifetime is never taken as proof the cache is gone.
 */
export function decideSmartRoutingRecheck(input: {
	turnBoundary: boolean;
	/** User turns since the last check, including this one. */
	turnsSinceCheck: number;
	idleSeconds?: number;
	cacheMaxIdleSeconds?: number;
	policy?: SmartRoutingPolicy;
}): SmartRoutingRecheckTrigger | null {
	const policy = input.policy ?? SMART_ROUTING_POLICY;
	if (!input.turnBoundary) {
		return null;
	}
	if (
		input.idleSeconds !== undefined &&
		input.cacheMaxIdleSeconds !== undefined &&
		input.idleSeconds > input.cacheMaxIdleSeconds
	) {
		return "cache-expired";
	}
	if (input.turnsSinceCheck >= policy.scanEveryTurns) {
		return "scan";
	}
	return null;
}

export interface SmartRoutingPickPrices {
	inputPrice?: string | number;
	cachedInputPrice?: string | number;
	cacheWriteInputPrice?: string | number;
	outputPrice?: string | number;
}

export interface SmartRoutingWorkload {
	/** Average prompt tokens a user turn sends across all of its requests. */
	promptTokensPerTurn: number;
	/** Average output tokens a user turn produces at the current effort. */
	outputTokensPerTurn: number;
	/** Share of prompt tokens served from the provider's cache. */
	cacheHitRate: number;
	/** Prompt size of the latest request: what a cache rebuild rereads. */
	contextTokens: number;
}

export interface SmartRoutingEconomics {
	stayUsd: number;
	switchUsd: number;
}

function toDecimal(value: string | number | undefined): Decimal | undefined {
	return value === undefined ? undefined : new Decimal(value);
}

function blendedInputPrice(
	prices: SmartRoutingPickPrices,
	hitRate: number,
): Decimal | undefined {
	const input = toDecimal(prices.inputPrice);
	if (!input) {
		return undefined;
	}
	const cached = toDecimal(prices.cachedInputPrice) ?? input;
	return cached.times(hitRate).plus(input.times(1 - hitRate));
}

/**
 * What the first request after losing the cache pays on top of a warm one:
 * the context is reread at the cache-write (or uncached) rate instead of the
 * cached blend.
 */
function rebuildPremium(
	prices: SmartRoutingPickPrices,
	workload: SmartRoutingWorkload,
): Decimal {
	const blended = blendedInputPrice(prices, workload.cacheHitRate)!;
	const write =
		toDecimal(prices.cacheWriteInputPrice) ?? toDecimal(prices.inputPrice)!;
	return Decimal.max(0, write.minus(blended)).times(workload.contextTokens);
}

export function estimateRemainingTurns(
	turnCount: number,
	policy: SmartRoutingPolicy = SMART_ROUTING_POLICY,
): number {
	return Math.min(Math.max(turnCount, 1), policy.maxRemainingTurns);
}

/**
 * Expected cost of the remaining work if the session stays on its current
 * choice versus moving to the proposal, including the routing check and the
 * cache rebuild a move causes. Returns `null` when a price is unknown: a
 * missing price is never read as free, so a cost-only switch is skipped.
 */
export function estimateSmartRoutingEconomics(input: {
	current: { prices: SmartRoutingPickPrices; effort?: SmartRoutingEffort };
	proposed: { prices: SmartRoutingPickPrices; effort?: SmartRoutingEffort };
	workload: SmartRoutingWorkload;
	remainingTurns: number;
	/** False when the current choice's cache is already known to be gone. */
	currentCacheWarm: boolean;
	/** Whether moving to the proposal discards the cached prefix. */
	switchBreaksCache: boolean;
	checkCostUsd: number;
}): SmartRoutingEconomics | null {
	const { current, proposed, workload } = input;
	for (const prices of [current.prices, proposed.prices]) {
		if (prices.inputPrice === undefined || prices.outputPrice === undefined) {
			return null;
		}
	}

	const proposedOutputTokens =
		current.effort && proposed.effort
			? (workload.outputTokensPerTurn *
					SMART_ROUTING_EFFORT_OUTPUT_WEIGHT[proposed.effort]) /
				SMART_ROUTING_EFFORT_OUTPUT_WEIGHT[current.effort]
			: workload.outputTokensPerTurn;

	const turnCost = (prices: SmartRoutingPickPrices, outputTokens: number) =>
		blendedInputPrice(prices, workload.cacheHitRate)!
			.times(workload.promptTokensPerTurn)
			.plus(new Decimal(prices.outputPrice!).times(outputTokens));

	let stay = turnCost(current.prices, workload.outputTokensPerTurn).times(
		input.remainingTurns,
	);
	if (!input.currentCacheWarm) {
		stay = stay.plus(rebuildPremium(current.prices, workload));
	}

	let switchCost = turnCost(proposed.prices, proposedOutputTokens)
		.times(input.remainingTurns)
		.plus(input.checkCostUsd);
	if (input.switchBreaksCache || !input.currentCacheWarm) {
		switchCost = switchCost.plus(rebuildPremium(proposed.prices, workload));
	}

	return { stayUsd: stay.toNumber(), switchUsd: switchCost.toNumber() };
}

export interface SmartRoutingPick {
	modelId: string;
	band: SmartRoutingDifficulty;
	effort?: SmartRoutingEffort;
}

export type SmartRoutingSwitchDirection = "upgrade" | "downgrade" | "lateral";

export type SmartRoutingSwitchReason =
	| "unchanged"
	| "work-unclear"
	| "low-confidence"
	| "work-unchanged"
	| "below-required-band"
	| "harder-work"
	| "cooldown"
	| "unknown-prices"
	| "insufficient-savings"
	| "savings";

export interface SmartRoutingSwitchDecision {
	apply: boolean;
	direction?: SmartRoutingSwitchDirection;
	reason: SmartRoutingSwitchReason;
}

function switchDirection(
	current: SmartRoutingPick,
	proposed: SmartRoutingPick,
): SmartRoutingSwitchDirection {
	const bandDelta =
		SMART_ROUTING_DIFFICULTIES.indexOf(proposed.band) -
		SMART_ROUTING_DIFFICULTIES.indexOf(current.band);
	const effortDelta =
		current.effort && proposed.effort
			? SMART_ROUTING_EFFORTS.indexOf(proposed.effort) -
				SMART_ROUTING_EFFORTS.indexOf(current.effort)
			: 0;
	if (bandDelta > 0 || (bandDelta === 0 && effortDelta > 0)) {
		return "upgrade";
	}
	if (bandDelta < 0 || effortDelta < 0) {
		return "downgrade";
	}
	return "lateral";
}

/**
 * Whether a recheck's proposal replaces the session's current choice. Quality
 * comes first: harder work upgrades without a cost check. Anything else is a
 * cost-driven move and needs a confident signal, a cooldown since the last
 * switch, known prices, and savings above the margin once the check and the
 * cache rebuild are paid for. An unclear or unconfident signal keeps the
 * current choice.
 */
export function decideSmartRoutingSwitch(input: {
	current: SmartRoutingPick;
	proposed: SmartRoutingPick;
	classification: RequestClassification;
	/** User turns since the last switch (or the opening choice). */
	turnsSinceSwitch: number;
	economics: SmartRoutingEconomics | null;
	policy?: SmartRoutingPolicy;
}): SmartRoutingSwitchDecision {
	const policy = input.policy ?? SMART_ROUTING_POLICY;
	const { current, proposed, classification } = input;
	if (
		current.modelId === proposed.modelId &&
		current.effort === proposed.effort
	) {
		return { apply: false, reason: "unchanged" };
	}

	const direction = switchDirection(current, proposed);
	const keep = (reason: SmartRoutingSwitchReason) => ({
		apply: false,
		direction,
		reason,
	});

	const { workChange } = classification;
	if (!workChange || workChange === "unclear") {
		return keep("work-unclear");
	}
	if ((classification.workChangeConfidence ?? 0) < policy.minConfidence) {
		return keep("low-confidence");
	}
	if (workChange === "same") {
		return keep("work-unchanged");
	}
	// An upgrade only improves the fit, even when no candidate occupies the
	// classified band and the proposal is the best one below it.
	if (
		direction !== "upgrade" &&
		SMART_ROUTING_DIFFICULTIES.indexOf(proposed.band) <
			SMART_ROUTING_DIFFICULTIES.indexOf(classification.difficulty)
	) {
		return keep("below-required-band");
	}

	if (direction === "upgrade") {
		return workChange === "easier"
			? keep("work-unclear")
			: { apply: true, direction, reason: "harder-work" };
	}
	if (workChange === "harder") {
		return keep("work-unclear");
	}
	if (input.turnsSinceSwitch < policy.costSwitchCooldownTurns) {
		return keep("cooldown");
	}
	if (!input.economics) {
		return keep("unknown-prices");
	}
	const stay = new Decimal(input.economics.stayUsd);
	const saving = stay.minus(input.economics.switchUsd);
	const required = Decimal.max(
		stay.times(policy.savingsMargin),
		policy.minSavingsUsd,
	);
	return saving.gt(required)
		? { apply: true, direction, reason: "savings" }
		: keep("insufficient-savings");
}
