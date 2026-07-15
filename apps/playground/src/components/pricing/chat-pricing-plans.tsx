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
	/** Approx. monthly cost of the separate subscriptions this tier replaces. */
	replacesSubsUsd?: number;
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
			"Upgrade to frontier models anytime — prorated",
		],
	},
	{
		name: "Plus",
		tier: "plus",
		description: "Every frontier model in one place",
		tagline: "Replaces ChatGPT Plus + Claude Pro + Gemini",
		popular: true,
		frontierIncluded: true,
		replacesSubsUsd: 60,
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
		replacesSubsUsd: 60,
		features: [
			"Everything in Plus, with the most headroom",
			"Best 3× credit rate — lowest cost per message",
			"Priority support",
		],
	},
];

function formatUsd(amount: number): string {
	return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(0)}`;
}

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
				"Cancel your chat plan? You'll keep access until the end of the current cycle.",
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
			toast.success("Plan cancelled — access continues until period end");
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
			toast.success("Plan resumed");
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
								Current plan
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
										"Cancel plan"
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
							className={`relative flex flex-col rounded-2xl border bg-card p-7 transition-all ${
								plan.popular
									? "border-foreground/30 shadow-lg ring-1 ring-foreground/10"
									: "hover:shadow-md"
							} ${isCurrent ? "ring-2 ring-emerald-500/40" : ""}`}
						>
							{plan.popular && !isCurrent && (
								<div className="absolute -top-3 left-6">
									<span className="rounded-full bg-foreground px-3 py-1 text-xs font-medium text-background">
										Most popular
									</span>
								</div>
							)}
							{isCurrent && (
								<div className="absolute -top-3 left-6">
									<span className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-medium text-white">
										Your plan
									</span>
								</div>
							)}

							<div className="mb-5">
								<h3 className="text-lg font-semibold">{plan.name}</h3>
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

							{plan.replacesSubsUsd && (
								<div className="mb-5 rounded-xl border border-foreground/15 bg-foreground/[0.04] px-4 py-3 text-sm">
									<span className="font-semibold text-foreground">
										Replaces ~${plan.replacesSubsUsd}/mo
									</span>{" "}
									<span className="text-muted-foreground">
										of ChatGPT Plus + Claude Pro + Gemini — for ${monthlyPrice}.
									</span>
								</div>
							)}

							<div className="mb-5 rounded-xl border border-dashed bg-muted/40 p-4">
								<div className="mb-3 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
									<span>What you actually get</span>
									<span className="rounded-full bg-foreground/90 px-2 py-0.5 text-[10px] font-bold tabular-nums text-background">
										{creditsMultiplier}× value
									</span>
								</div>
								<div className="space-y-2.5 text-sm">
									<div className="flex items-baseline justify-between">
										<span className="text-muted-foreground">You pay</span>
										<span className="font-mono font-semibold tabular-nums">
											${monthlyPrice}
											<span className="text-xs font-normal text-muted-foreground">
												/mo
											</span>
										</span>
									</div>
									<div className="flex items-baseline justify-between">
										<span className="text-muted-foreground">You use</span>
										<span className="font-mono font-semibold tabular-nums text-foreground">
											{formatUsd(usageValue)}
											<span className="text-xs font-normal text-muted-foreground">
												{" "}
												at provider rates
											</span>
										</span>
									</div>
									<div className="pt-1">
										<div className="relative h-2 overflow-hidden rounded-full bg-foreground/10">
											<div
												className="absolute left-0 top-0 h-full rounded-full bg-foreground/30"
												style={{
													width: `${(1 / creditsMultiplier) * 100}%`,
												}}
											/>
											<div className="absolute left-0 top-0 h-full w-full rounded-full ring-1 ring-inset ring-foreground/10" />
										</div>
										<div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
											<span>${monthlyPrice} paid</span>
											<span>{formatUsd(usageValue)} used</span>
										</div>
									</div>
									<div className="border-t border-dashed pt-2.5 text-xs leading-relaxed text-muted-foreground">
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
							</div>

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
									"Current plan"
								) : isChangeTarget ? (
									`Switch to ${plan.name}`
								) : (
									`Get ${plan.name}`
								)}
							</Button>
							<InvoiceInfoLabel />
						</div>
					);
				})}
			</div>

			<div className="mx-auto mt-8 flex max-w-2xl items-center justify-center gap-2 text-center text-sm text-muted-foreground">
				<ShieldCheck className="h-4 w-4 shrink-0 text-foreground/70" />
				<span>
					<span className="font-medium text-foreground">
						7-day money-back guarantee.
					</span>{" "}
					If you&apos;ve barely used your plan, email us within 7 days for a
					full refund.
				</span>
			</div>

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
