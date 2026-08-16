"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useApi, useFetchClient } from "@/lib/fetch-client";
import { formatCredits } from "@/lib/format-credits";

import {
	CHAT_PLAN_CREDITS_MULTIPLIERS,
	CHAT_PLAN_PRICES,
	estimateChatPlanMessages,
	SELF_REFUND_USAGE_PERCENT,
	SELF_REFUND_WINDOW_DAYS,
	type ChatPlanTier,
} from "@llmgateway/shared";

interface PlanContent {
	name: string;
	tier: ChatPlanTier;
	description: string;
	tagline: string;
	popular?: boolean;
	/** Whether the tier unlocks the frontier flagships (Opus, GPT-5, …). */
	frontierIncluded: boolean;
	features: string[];
}

const plans: PlanContent[] = [
	{
		name: "Starter",
		tier: "starter",
		description: "Everyday chat on fast, capable models",
		tagline: "All the fast models, one bill",
		frontierIncluded: false,
		features: [
			"Claude Sonnet plus fast models like Haiku & Gemini Flash",
			"Chat, image, video & audio studios",
			"Real-time usage and per-message cost",
			"Upgrade to frontier models anytime — takes effect instantly",
		],
	},
	{
		name: "Plus",
		tier: "plus",
		description: "Every frontier model in one place",
		tagline: "Replaces ChatGPT Plus + Claude Pro + Gemini",
		popular: true,
		frontierIncluded: true,
		features: [
			"Claude Opus, GPT-5, Gemini Pro & Grok 4 — every frontier model",
			"Chat, image, video & audio studios",
			"Headroom for long daily sessions",
			"Email support",
		],
	},
	{
		name: "Pro",
		tier: "pro",
		description: "For all-day, heavy use",
		tagline: "Most usage, best per-dollar rate",
		frontierIncluded: true,
		features: [
			"Everything in Plus, with the most headroom",
			"Best 3× credit rate — lowest cost per message",
			"Priority support",
		],
	},
];

/** Round to two significant figures and group, e.g. 3015 → "3,000". */
function formatCount(n: number): string {
	if (n <= 0) {
		return "0";
	}
	const digits = Math.floor(Math.log10(n)) + 1;
	const factor = Math.pow(10, Math.max(0, digits - 2));
	return (Math.round(n / factor) * factor).toLocaleString("en-US");
}

interface ChatPricingPlansProps {
	isAuthenticated: boolean;
	creditsMultipliers?: Record<ChatPlanTier, number>;
	/** Where the plans are rendered — used for funnel analytics. */
	viewSource?: "pricing_page" | "paywall";
}

export function ChatPricingPlans({
	isAuthenticated,
	creditsMultipliers = CHAT_PLAN_CREDITS_MULTIPLIERS,
	viewSource = "pricing_page",
}: ChatPricingPlansProps) {
	const router = useRouter();
	const fetchClient = useFetchClient();
	const api = useApi();
	const queryClient = useQueryClient();
	const posthog = usePostHog();

	const viewedRef = useRef(false);
	useEffect(() => {
		if (viewedRef.current) {
			return;
		}
		viewedRef.current = true;
		posthog.capture("chat_pricing_viewed", { source: viewSource });
	}, [posthog, viewSource]);

	const statusQuery = useQuery({
		...api.queryOptions("get", "/chat-plans/status"),
		enabled: isAuthenticated,
	});
	const status = statusQuery.data;
	const activeTier =
		status && status.chatPlan !== "none" ? status.chatPlan : null;

	const [pendingTier, setPendingTier] = useState<ChatPlanTier | null>(null);
	const [pendingAction, setPendingAction] = useState<
		"cancel" | "resume" | null
	>(null);

	async function refresh() {
		await queryClient.invalidateQueries({
			queryKey: api.queryOptions("get", "/chat-plans/status").queryKey,
		});
	}

	async function handleSubscribe(tier: ChatPlanTier) {
		posthog.capture("pricing_plan_clicked", {
			app: "chat",
			plan: tier,
			price: CHAT_PLAN_PRICES[tier],
			source: viewSource,
		});
		if (!isAuthenticated) {
			router.push(`/login?next=${encodeURIComponent(`/pricing?plan=${tier}`)}`);
			return;
		}
		setPendingTier(tier);
		try {
			const { data, error } = await fetchClient.POST("/chat-plans/subscribe", {
				body: { tier },
			});
			if (error || !data) {
				toast.error(
					typeof error === "object" && error && "message" in error
						? String(
								(error as { message?: unknown }).message ?? "Subscribe failed",
							)
						: "Subscribe failed",
				);
				return;
			}
			window.location.href = data.checkoutUrl;
		} finally {
			setPendingTier(null);
		}
	}

	async function handleChangeTier(newTier: ChatPlanTier) {
		posthog.capture("pricing_plan_clicked", {
			app: "chat",
			plan: newTier,
			price: CHAT_PLAN_PRICES[newTier],
			source: viewSource,
			action: "change_tier",
		});
		setPendingTier(newTier);
		try {
			const { error } = await fetchClient.POST("/chat-plans/change-tier", {
				body: { newTier },
			});
			if (error) {
				toast.error(
					typeof error === "object" && error && "message" in error
						? String(
								(error as { message?: unknown }).message ?? "Change failed",
							)
						: "Change failed",
				);
				return;
			}
			toast.success(`Switched to ${newTier}`);
			await refresh();
		} finally {
			setPendingTier(null);
		}
	}

	async function handleCancel() {
		if (
			!confirm(
				"Cancel your Lounge membership? You'll keep access until the end of the current cycle.",
			)
		) {
			return;
		}
		setPendingAction("cancel");
		try {
			const { error } = await fetchClient.POST("/chat-plans/cancel", {});
			if (error) {
				toast.error("Cancellation failed");
				return;
			}
			toast.success("Membership cancelled — access continues until period end");
			await refresh();
		} finally {
			setPendingAction(null);
		}
	}

	async function handleResume() {
		setPendingAction("resume");
		try {
			const { error } = await fetchClient.POST("/chat-plans/resume", {});
			if (error) {
				toast.error("Resume failed");
				return;
			}
			toast.success("Membership resumed");
			await refresh();
		} finally {
			setPendingAction(null);
		}
	}

	return (
		<div>
			{activeTier && status && (
				<div className="mx-auto mb-8 max-w-2xl rounded-xl border bg-card p-5 shadow-sm">
					<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
								Your membership
							</div>
							<div className="mt-1 text-lg font-semibold">
								{activeTier[0].toUpperCase() + activeTier.slice(1)}
							</div>
							<div className="mt-1 text-xs text-muted-foreground tabular-nums">
								${formatCredits(Number(status.chatPlanCreditsUsed))} of $
								{formatCredits(Number(status.chatPlanCreditsLimit))} used
								{status.chatPlanExpiresAt
									? ` · ${status.chatPlanCancelled ? "ends" : "renews"} ${new Date(
											status.chatPlanExpiresAt,
										).toLocaleDateString()}`
									: ""}
							</div>
						</div>
						<div className="flex gap-2">
							{status.chatPlanCancelled ? (
								<Button
									size="sm"
									variant="default"
									onClick={handleResume}
									disabled={pendingAction === "resume"}
								>
									{pendingAction === "resume" ? (
										<Loader2 className="h-4 w-4 animate-spin" />
									) : (
										"Resume"
									)}
								</Button>
							) : (
								<Button
									size="sm"
									variant="outline"
									onClick={handleCancel}
									disabled={pendingAction === "cancel"}
								>
									{pendingAction === "cancel" ? (
										<Loader2 className="h-4 w-4 animate-spin" />
									) : (
										"Cancel membership"
									)}
								</Button>
							)}
						</div>
					</div>
				</div>
			)}

			<div className="grid gap-6 md:grid-cols-3">
				{plans.map((plan) => {
					const monthlyPrice = CHAT_PLAN_PRICES[plan.tier];
					const creditsMultiplier = creditsMultipliers[plan.tier];
					const usageValue = monthlyPrice * creditsMultiplier;
					const estimate = estimateChatPlanMessages(usageValue);
					const isPending = pendingTier === plan.tier;
					const isCurrent = activeTier === plan.tier;
					const isChangeTarget = Boolean(activeTier) && !isCurrent;

					return (
						<div
							key={plan.tier}
							className={`relative flex flex-col rounded-2xl border bg-card transition-all ${
								plan.popular
									? "border-lounge-gold/45 shadow-lg ring-1 ring-lounge-gold/20"
									: "hover:shadow-md"
							} ${isCurrent ? "ring-2 ring-emerald-500/40" : ""}`}
						>
							{plan.popular && !isCurrent && (
								<div className="absolute -top-3 left-6">
									<span className="rounded-full bg-lounge-gold px-3 py-1 text-xs font-semibold text-zinc-950">
										Most popular
									</span>
								</div>
							)}
							{isCurrent && (
								<div className="absolute -top-3 left-6">
									<span className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-medium text-white">
										Your membership
									</span>
								</div>
							)}

							<div className="flex items-center justify-between border-b border-dashed border-foreground/15 px-7 pb-3 pt-5 text-[10px] font-semibold uppercase tracking-[0.24em]">
								<span
									className={
										plan.frontierIncluded
											? "text-lounge-gold"
											: "text-muted-foreground"
									}
								>
									The Lounge · Member Pass
								</span>
								<span className="font-mono text-muted-foreground">
									LNG-{plan.tier.slice(0, 2).toUpperCase()}
								</span>
							</div>

							<div className="flex flex-col px-7 pt-5">
								<div className="mb-5">
									<h3 className="font-display text-2xl font-semibold">
										{plan.name}
									</h3>
									<p className="mt-1 text-sm text-muted-foreground">
										{plan.description}
									</p>
								</div>

								<div className="mb-1 flex items-baseline gap-1.5">
									<span className="text-5xl font-bold tracking-tight tabular-nums">
										${monthlyPrice}
									</span>
									<span className="text-muted-foreground">/mo</span>
								</div>
								<div className="mb-5 min-h-[20px] text-xs text-muted-foreground">
									{plan.tagline}
								</div>

								<div className="mb-5 flex items-center gap-3 rounded-xl border border-lounge-gold/30 bg-lounge-gold/[0.06] p-4">
									<span className="inline-flex shrink-0 items-center rounded-full bg-foreground/90 px-2.5 py-1 font-mono text-xs font-bold tabular-nums text-background">
										{creditsMultiplier}× value
									</span>
									<p className="text-xs leading-relaxed text-muted-foreground">
										Worth {creditsMultiplier}× what you pay in model usage,
										metered at provider list rates.
									</p>
								</div>

								<div className="mb-5 rounded-xl border border-dashed bg-muted/40 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
									{plan.frontierIncluded ? (
										<>
											≈{" "}
											<span className="font-semibold text-foreground tabular-nums">
												{formatCount(estimate.frontier)}
											</span>{" "}
											messages/mo on frontier models —{" "}
											<span className="font-semibold text-foreground tabular-nums">
												{formatCount(estimate.fast)}
											</span>{" "}
											on fast ones
										</>
									) : (
										<>
											≈{" "}
											<span className="font-semibold text-foreground tabular-nums">
												{formatCount(estimate.fast)}
											</span>{" "}
											messages/mo on fast models —{" "}
											<span className="font-semibold text-foreground tabular-nums">
												{formatCount(estimate.frontier)}
											</span>{" "}
											on Claude Sonnet
										</>
									)}
								</div>
							</div>

							<div className="relative" aria-hidden>
								<div className="mx-7 border-t border-dashed border-foreground/20" />
								<span className="absolute -left-3 top-1/2 size-6 -translate-y-1/2 rounded-full border bg-background" />
								<span className="absolute -right-3 top-1/2 size-6 -translate-y-1/2 rounded-full border bg-background" />
							</div>

							<div className="flex flex-1 flex-col px-7 pb-7 pt-5">
								<ul className="mb-7 flex-1 space-y-2.5">
									{plan.features.map((feature) => (
										<li key={feature} className="flex items-start gap-2.5">
											<Check className="mt-0.5 h-4 w-4 shrink-0 text-foreground/70" />
											<span className="text-sm text-muted-foreground">
												{feature}
											</span>
										</li>
									))}
								</ul>

								<Button
									className="w-full"
									size="lg"
									variant={plan.popular && !isCurrent ? "default" : "outline"}
									disabled={isPending || isCurrent}
									onClick={() =>
										isChangeTarget
											? handleChangeTier(plan.tier)
											: handleSubscribe(plan.tier)
									}
								>
									{isPending ? (
										<>
											<Loader2 className="mr-2 h-4 w-4 animate-spin" />
											{isChangeTarget ? "Switching…" : "Redirecting…"}
										</>
									) : isCurrent ? (
										"Your membership"
									) : isChangeTarget ? (
										`Switch to ${plan.name}`
									) : (
										`Get ${plan.name}`
									)}
								</Button>
								<InvoiceInfoLabel />
								<div aria-hidden className="mt-5">
									<div
										className="h-8 text-foreground/60"
										style={{
											backgroundImage:
												"repeating-linear-gradient(90deg, currentColor 0 2px, transparent 2px 4px, currentColor 4px 7px, transparent 7px 9px, currentColor 9px 10px, transparent 10px 14px, currentColor 14px 15px, transparent 15px 18px)",
										}}
									/>
									<div className="mt-1.5 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.28em] text-muted-foreground">
										<span>lounge.llmgateway.io</span>
										<span>{plan.tier} · monthly</span>
									</div>
								</div>
							</div>
						</div>
					);
				})}
			</div>

			<p className="mx-auto mt-8 max-w-2xl text-center text-sm text-muted-foreground">
				<ShieldCheck className="mr-1.5 inline-block h-4 w-4 -translate-y-px align-middle text-foreground/70" />
				<span className="font-medium text-foreground">
					{SELF_REFUND_WINDOW_DAYS}-day money-back guarantee.
				</span>{" "}
				Barely used your membership? Refund yourself from your billing history —
				a full refund while you&apos;re under {SELF_REFUND_USAGE_PERCENT}% of
				your allowance, no email needed.
			</p>

			<p className="mt-4 text-center text-xs text-muted-foreground">
				Your allowance refills in full every cycle and any unspent credits
				don&apos;t roll over.
			</p>
		</div>
	);
}

function InvoiceInfoLabel() {
	return (
		<p className="mt-2 text-center text-[11px] leading-relaxed text-muted-foreground">
			Need company/address details on your invoice? Update billing settings
			before purchase. We email the invoice automatically after payment.
		</p>
	);
}
