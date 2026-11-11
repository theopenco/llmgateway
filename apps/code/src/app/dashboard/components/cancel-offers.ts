import {
	getDevPlanCycleUsageFraction,
	type DevPlanCancellationReason,
} from "@llmgateway/shared";

import type { PlanOption, PlanTier } from "@/app/dashboard/types";

export interface CarryOver {
	// What the next renewal carries over at current usage.
	amount: number;
	// Everything left of this cycle; more than `amount` when the cap binds.
	unused: number;
	capped: boolean;
}

export type SaveOffer =
	| { kind: "downgrade"; tier: PlanTier }
	| { kind: "upgrade"; tier: PlanTier }
	| ({ kind: "rollover" } & CarryOver)
	| {
			kind: "link";
			id: "agents" | "models" | "compare" | "overflow" | "support";
			href: string;
			external: boolean;
			title: string;
			body: string;
			cta: string;
	  };

export interface CancelContext {
	tier: PlanTier;
	pendingTier: PlanTier | null;
	creditsUsed: number;
	creditsLimit: number;
	renewalRollover: number;
	paygEnabled: boolean;
	plans: PlanOption[];
	docsUrl: string;
	discordUrl: string;
}

// A smaller plan only fits while the cycle still has room: someone who has
// burned through most of the allowance isn't kept by less of it. Measured
// against the plan's own allowance, so carried-over allowance does not make a
// heavy month look light.
const DOWNGRADE_MAX_UTILIZATION = 0.4;

// Share of the renewing plan's allowance a carry-over must reach to be worth
// showing to someone who is about to cancel.
const CARRY_OVER_OFFER_MIN_SHARE = 0.1;

const LOWER_TIER: Record<PlanTier, PlanTier | null> = {
	lite: null,
	pro: "lite",
	max: "pro",
};

const HIGHER_TIER: Record<PlanTier, PlanTier | null> = {
	lite: "pro",
	pro: "max",
	max: null,
};

export function planName(plans: PlanOption[], tier: PlanTier): string {
	return plans.find((p) => p.tier === tier)?.name ?? tier.toUpperCase();
}

export function planUsage(plans: PlanOption[], tier: PlanTier): number {
	return plans.find((p) => p.tier === tier)?.usage ?? 0;
}

export function resolveCarryOver({
	tier,
	pendingTier,
	creditsUsed,
	creditsLimit,
	renewalRollover,
	plans,
}: CancelContext): CarryOver | null {
	const floor =
		planUsage(plans, pendingTier ?? tier) * CARRY_OVER_OFFER_MIN_SHARE;
	if (renewalRollover <= 0 || renewalRollover < floor) {
		return null;
	}
	const unused = Math.max(0, creditsLimit - creditsUsed);
	return {
		amount: renewalRollover,
		unused,
		capped: unused - renewalRollover >= 0.01,
	};
}

export function resolveOffer(
	reason: DevPlanCancellationReason,
	context: CancelContext,
): SaveOffer | null {
	const { tier, pendingTier, creditsUsed, plans, paygEnabled } = context;
	switch (reason) {
		case "too_expensive":
		case "not_using_enough":
		case "just_testing": {
			const lower = LOWER_TIER[tier];
			const planUtilization = getDevPlanCycleUsageFraction(
				creditsUsed,
				planUsage(plans, tier),
			);
			// A scheduled tier change already exists; change-tier would 409.
			if (
				lower &&
				!pendingTier &&
				planUtilization < DOWNGRADE_MAX_UTILIZATION
			) {
				return { kind: "downgrade", tier: lower };
			}
			const carryOver = resolveCarryOver(context);
			return carryOver ? { kind: "rollover", ...carryOver } : null;
		}
		case "allowance_too_small": {
			const higher = HIGHER_TIER[tier];
			if (higher && !pendingTier) {
				return { kind: "upgrade", tier: higher };
			}
			return {
				kind: "link",
				id: "overflow",
				href: "/dashboard/usage#payg-card",
				external: false,
				title: "Keep going past the allowance",
				body: paygEnabled
					? "Pay-as-you-go overflow is on for this plan: once the allowance or the weekly premium cap is reached, requests keep flowing from your credits balance at provider rates. Top the balance up to stay unblocked."
					: "Pay-as-you-go overflow keeps requests flowing once the plan allowance or the weekly premium cap is reached, billed to a credits balance at provider rates. It stays off until you opt in.",
				cta: paygEnabled ? "Top up credits" : "Open overflow settings",
			};
		}
		case "tool_not_supported":
			return {
				kind: "link",
				id: "agents",
				href: `${context.docsUrl}/learn/coding-agents`,
				external: true,
				title: "Most tools already work",
				body: "Anything that speaks the OpenAI or Anthropic API can run on your DevPass key. The setup guides cover the usual editors, agents and CLIs.",
				cta: "See supported tools",
			};
		case "missing_features":
			return {
				kind: "link",
				id: "models",
				href: "/models",
				external: false,
				title: "New models land every week",
				body: "Every model in the catalogue is on your plan the day it ships. Check whether what you need is already there.",
				cta: "Browse the catalogue",
			};
		case "switched_alternative":
			return {
				kind: "link",
				id: "compare",
				href: "/compare",
				external: false,
				title: "See how it stacks up",
				body: "Side by side with the plan you're moving to: models, limits, tooling and price.",
				cta: "Compare plans",
			};
		case "other":
			return {
				kind: "link",
				id: "support",
				href: context.discordUrl,
				external: true,
				title: "Talk it through with us",
				body: "If something broke or didn't work the way you expected, tell us in Discord before you go. We would rather fix it than lose you.",
				cta: "Open Discord",
			};
		default:
			return null;
	}
}
