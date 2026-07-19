"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Loader2, Plane, Stamp } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePostHog } from "posthog-js/react";
import { useState } from "react";
import { toast } from "sonner";

import { plans } from "@/app/dashboard/plans";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useAppConfig } from "@/lib/config";
import { useApi } from "@/lib/fetch-client";

import {
	DEV_PLAN_RESET_PASS_PURCHASE_MAX_CYCLE_USAGE,
	DEV_PLAN_RESET_PASS_REDEEM_MAX_CYCLE_USAGE,
	getDevPlanCycleUsageFraction,
} from "@llmgateway/shared";

interface ResetPassCardProps {
	tier: string;
	organizationId: string | null;
	purchased: number;
	includedTotal: number;
	includedRemaining: number;
	price: number | null;
	premiumCreditsUsed: number;
	premiumWeeklyLimit: number;
	cycleCreditsUsed: number;
	cycleCreditsLimit: number;
}

// A single visa-stamp slot in the pass strip. Held passes render as inked
// stamps; spent/empty slots stay as faint dashed outlines, like the unused
// squares of a passport page.
function PassStamp({
	filled,
	kind,
	index,
}: {
	filled: boolean;
	kind: "included" | "purchased";
	index: number;
}) {
	const ink =
		kind === "included"
			? "border-emerald-700/70 text-emerald-800 dark:border-emerald-400/60 dark:text-emerald-300"
			: "border-indigo-700/70 text-indigo-800 dark:border-indigo-400/60 dark:text-indigo-300";
	return (
		<motion.div
			initial={filled ? { opacity: 0, scale: 1.6, rotate: -14 } : false}
			animate={
				filled
					? { opacity: 1, scale: 1, rotate: index % 2 === 0 ? -6 : 4 }
					: { opacity: 1 }
			}
			transition={{ type: "spring", duration: 0.45, delay: index * 0.08 }}
			className={
				filled
					? `flex h-14 w-14 flex-col items-center justify-center rounded-full border-[3px] border-double text-center font-mono uppercase mix-blend-multiply dark:mix-blend-screen ${ink}`
					: "flex h-14 w-14 flex-col items-center justify-center rounded-full border-2 border-dashed border-stone-300 text-stone-300 dark:border-stone-700 dark:text-stone-700"
			}
			title={
				filled
					? kind === "included"
						? "Included with your plan this cycle"
						: "Purchased Reset Pass"
					: "Empty stamp slot"
			}
		>
			{filled ? (
				<>
					<span className="text-[7px] leading-none tracking-[0.18em]">
						RESET
					</span>
					<Stamp className="my-0.5 h-3.5 w-3.5" />
					<span className="text-[6px] leading-none tracking-[0.14em]">
						{kind === "included" ? "INCLUDED" : "PURCHASED"}
					</span>
				</>
			) : (
				<span className="font-mono text-[8px] tracking-[0.2em]">·</span>
			)}
		</motion.div>
	);
}

export default function ResetPassCard({
	tier,
	organizationId,
	purchased,
	includedTotal,
	includedRemaining,
	price,
	premiumCreditsUsed,
	premiumWeeklyLimit,
	cycleCreditsUsed,
	cycleCreditsLimit,
}: ResetPassCardProps) {
	const api = useApi();
	const queryClient = useQueryClient();
	const { uiUrl, posthogKey } = useAppConfig();
	const posthog = usePostHog();
	const [justStamped, setJustStamped] = useState(false);

	const available = includedRemaining + purchased;
	const nothingToReset = premiumCreditsUsed <= 0;
	// Mirrors the server-side gates: near the end of the monthly credit pool a
	// pass restores a cap there's nothing left to spend against, so buying is
	// blocked above 95% cycle usage and redeeming above 90%.
	const cycleUsage = getDevPlanCycleUsageFraction(
		cycleCreditsUsed,
		cycleCreditsLimit,
	);
	const purchaseBlocked =
		cycleUsage > DEV_PLAN_RESET_PASS_PURCHASE_MAX_CYCLE_USAGE;
	const redeemBlocked = cycleUsage > DEV_PLAN_RESET_PASS_REDEEM_MAX_CYCLE_USAGE;
	const serial = (organizationId ?? "GATEWAY").slice(-6).toUpperCase();

	// Once the gates kick in, passes are a dead end for the rest of the cycle —
	// give the user the action that actually helps instead: a tier upgrade
	// (fresh cycle, full allowance, immediately) or PAYG credits on the top
	// tier, mirroring the promo shown at full exhaustion.
	const currentIndex = plans.findIndex((p) => p.tier === tier);
	const nextPlan = currentIndex >= 0 ? (plans[currentIndex + 1] ?? null) : null;
	const trackGateUpgradeClick = () => {
		if (posthogKey) {
			posthog.capture("devpass_reset_gate_upgrade_clicked", {
				tier,
				promo: nextPlan ? "upgrade" : "payg",
			});
		}
	};

	const invalidateStatus = () =>
		queryClient.invalidateQueries({
			predicate: (query) => {
				const key = query.queryKey;
				return Array.isArray(key) && key[1] === "/dev-plans/status";
			},
		});

	const redeemMutation = api.useMutation(
		"post",
		"/dev-plans/reset-pass/redeem",
		{
			onSuccess: async () => {
				setJustStamped(true);
				setTimeout(() => setJustStamped(false), 2200);
				await invalidateStatus();
			},
			onError: () => {
				toast.error("Could not redeem the pass. Refresh and try again.");
			},
		},
	);

	const purchaseMutation = api.useMutation(
		"post",
		"/dev-plans/reset-pass/purchase",
		{
			onSuccess: async (data) => {
				toast.success("Reset Pass stamped into your passport", {
					description: `$${data.amount} was charged to your saved payment method.`,
				});
				await invalidateStatus();
			},
			onError: (error) => {
				toast.error(
					(error as { message?: string })?.message ??
						"The payment could not be completed. Check your payment method and try again.",
				);
			},
		},
	);

	// Stamp slots: included first (they're consumed first), then purchased.
	// Cap the strip so a pass hoarder doesn't stretch the layout.
	const slots: { filled: boolean; kind: "included" | "purchased" }[] = [];
	for (let i = 0; i < includedTotal; i++) {
		slots.push({ filled: i < includedRemaining, kind: "included" });
	}
	for (let i = 0; i < Math.min(purchased, 4); i++) {
		slots.push({ filled: true, kind: "purchased" });
	}
	if (slots.length === 0) {
		slots.push({ filled: false, kind: "purchased" });
	}
	const overflow = purchased > 4 ? purchased - 4 : 0;

	return (
		<div className="relative mt-4 overflow-hidden rounded-lg border border-dashed border-stone-400/70 bg-stone-50/70 dark:border-stone-600/70 dark:bg-stone-900/30">
			{/* Full-card stamp slammed on a successful redeem */}
			<AnimatePresence>
				{justStamped && (
					<motion.div
						initial={{ opacity: 0, scale: 2.2, rotate: -18 }}
						animate={{ opacity: 1, scale: 1, rotate: -8 }}
						exit={{ opacity: 0 }}
						transition={{ type: "spring", duration: 0.4 }}
						className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
					>
						<div className="rounded-md border-4 border-double border-emerald-700/80 px-6 py-2 text-center font-mono uppercase text-emerald-800 mix-blend-multiply dark:border-emerald-400/80 dark:text-emerald-300 dark:mix-blend-screen">
							<div className="text-sm font-bold tracking-[0.3em]">
								Allowance restored
							</div>
							<div className="mt-0.5 text-[9px] tracking-[0.2em]">
								Fresh week · full premium limit
							</div>
						</div>
					</motion.div>
				)}
			</AnimatePresence>

			<div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 p-4 sm:p-5">
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-baseline justify-between gap-2">
						<div className="font-mono text-[10px] uppercase tracking-[0.35em] text-stone-500 dark:text-stone-400">
							Reset Pass · Visa Extension
						</div>
						<div className="font-mono text-[9px] tracking-[0.25em] text-stone-400 dark:text-stone-500">
							No. RP-{serial}
						</div>
					</div>
					<p className="mt-2 max-w-md text-sm text-muted-foreground">
						Stamp a fresh week: redeeming a pass instantly lifts the weekly
						premium limit (up to {`$${premiumWeeklyLimit.toFixed(2)} `}again) —
						it doesn&apos;t add credits; usage still draws from your monthly
						allowance.
						{includedTotal > 0 && (
							<>
								{" "}
								{tier.toUpperCase()} includes {includedTotal} pass
								{includedTotal === 1 ? "" : "es"} per cycle.
							</>
						)}
					</p>
					<div className="mt-3 flex flex-wrap items-center gap-2">
						<Button
							size="sm"
							onClick={() => redeemMutation.mutate({})}
							disabled={
								available === 0 ||
								nothingToReset ||
								redeemBlocked ||
								redeemMutation.isPending
							}
							title={
								redeemBlocked
									? "Over 90% of this cycle's credits are used — a reset would give you almost nothing. Your passes keep until your credits renew."
									: available === 0
										? "No passes held — buy one below"
										: nothingToReset
											? "Nothing to reset yet — your allowance is untouched"
											: undefined
							}
						>
							{redeemMutation.isPending ? (
								<Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
							) : (
								<Stamp className="mr-1.5 h-4 w-4" />
							)}
							Use a pass
						</Button>
						{price !== null && purchaseBlocked && (
							<Button
								size="sm"
								variant="outline"
								disabled
								title="Over 95% of this cycle's credits are used — a pass would give you almost nothing to use. Buy one again when your credits renew."
							>
								Buy a pass · ${price}
							</Button>
						)}
						{price !== null && !purchaseBlocked && (
							<AlertDialog>
								<AlertDialogTrigger asChild>
									<Button
										size="sm"
										variant={
											available === 0 && !redeemBlocked ? "default" : "outline"
										}
										disabled={purchaseMutation.isPending}
									>
										{purchaseMutation.isPending ? (
											<Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
										) : null}
										Buy a pass · ${price}
									</Button>
								</AlertDialogTrigger>
								<AlertDialogContent>
									<AlertDialogHeader>
										<AlertDialogTitle>
											Buy a Reset Pass for ${price}?
										</AlertDialogTitle>
										<AlertDialogDescription>
											Your saved payment method is charged {`$${price} `}now and
											one pass is stamped into your passport. Redeem it anytime
											to lift the weekly premium limit — it doesn&apos;t add
											credits; usage still draws from your monthly allowance.
										</AlertDialogDescription>
									</AlertDialogHeader>
									<AlertDialogFooter>
										<AlertDialogCancel>Not now</AlertDialogCancel>
										<AlertDialogAction
											onClick={() => purchaseMutation.mutate({})}
										>
											Charge ${price}
										</AlertDialogAction>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>
						)}
						{redeemBlocked &&
							(nextPlan ? (
								<Button size="sm" asChild onClick={trackGateUpgradeClick}>
									<Link href="/dashboard/billing">
										<Plane className="mr-1.5 h-4 w-4" />
										Upgrade to {nextPlan.name} · ${nextPlan.price}/mo
									</Link>
								</Button>
							) : (
								<Button size="sm" asChild onClick={trackGateUpgradeClick}>
									<a
										href={`${uiUrl}/dashboard?from=devpass-payg`}
										target="_blank"
										rel="noopener noreferrer"
									>
										Get PAYG credits on llmgateway.io
										<ArrowUpRight className="ml-1.5 h-4 w-4" />
									</a>
								</Button>
							))}
					</div>
					{redeemBlocked && (
						<p className="mt-2.5 max-w-md text-xs text-muted-foreground">
							Over 90% of this cycle&apos;s credits are used, so passes are on
							hold until your credits renew.{" "}
							{nextPlan ? (
								<>
									Upgrading to {nextPlan.name} starts a fresh cycle instantly
									with a {`$${nextPlan.usage} `}monthly allowance.
								</>
							) : (
								<>
									Pay-as-you-go credits on LLM Gateway work with the same coding
									agents — just swap your API key.
								</>
							)}
						</p>
					)}
				</div>

				<div className="flex items-center gap-2">
					{slots.map((slot, i) => (
						<PassStamp
							key={`${slot.kind}-${i}`}
							filled={slot.filled}
							kind={slot.kind}
							index={i}
						/>
					))}
					{overflow > 0 && (
						<div className="font-mono text-xs text-muted-foreground">
							+{overflow}
						</div>
					)}
				</div>
			</div>

			{/* Machine-readable zone, purely decorative */}
			<div
				aria-hidden="true"
				className="select-none overflow-hidden whitespace-nowrap border-t border-dashed border-stone-300/80 px-4 pb-1.5 pt-1 font-mono text-[9px] tracking-[0.3em] text-stone-400/80 dark:border-stone-700/80 dark:text-stone-600"
			>
				RP{`<`}LLMGATEWAY{`<<`}PREMIUM{`<`}RESET{`<`}
				{tier.toUpperCase()}
				{`<<`}
				{serial}
				{`<`.repeat(24)}
			</div>
		</div>
	);
}
