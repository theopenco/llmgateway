"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Ticket } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";

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
import { useApi } from "@/lib/fetch-client";

interface ResetPassCardProps {
	tier: string;
	purchased: number;
	includedTotal: number;
	includedRemaining: number;
	price: number | null;
	premiumCreditsUsed: number;
	premiumWeeklyLimit: number;
}

// Cap the visible strip so a pass hoarder doesn't stretch the layout; the
// overflow is summarized as "+N" after the last slot.
const MAX_PURCHASED_SLOTS = 4;

export default function ResetPassCard({
	tier,
	purchased,
	includedTotal,
	includedRemaining,
	price,
	premiumCreditsUsed,
	premiumWeeklyLimit,
}: ResetPassCardProps) {
	const api = useApi();
	const queryClient = useQueryClient();
	const [justRestored, setJustRestored] = useState(false);

	const available = includedRemaining + purchased;
	const nothingToReset = premiumCreditsUsed <= 0;

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
				setJustRestored(true);
				setTimeout(() => setJustRestored(false), 2600);
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
				toast.success("Reset Pass added", {
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

	// Slot strip: included first (they're consumed first), then purchased.
	const slots: { filled: boolean; kind: "included" | "purchased" }[] = [];
	for (let i = 0; i < includedTotal; i++) {
		slots.push({ filled: i < includedRemaining, kind: "included" });
	}
	for (let i = 0; i < Math.min(purchased, MAX_PURCHASED_SLOTS); i++) {
		slots.push({ filled: true, kind: "purchased" });
	}
	if (slots.length === 0) {
		slots.push({ filled: false, kind: "purchased" });
	}
	const overflow =
		purchased > MAX_PURCHASED_SLOTS ? purchased - MAX_PURCHASED_SLOTS : 0;

	const breakdown = [
		includedTotal > 0 ? `${includedRemaining} included` : null,
		purchased > 0 || includedTotal === 0 ? `${purchased} purchased` : null,
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<div className="mt-6 border-t pt-6">
			<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
				<div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground/70">
					<Ticket className="h-3.5 w-3.5" />
					Reset Passes
				</div>
				<div className="flex items-center gap-2">
					<AnimatePresence>
						{justRestored && (
							<motion.span
								initial={{ opacity: 0, y: 2 }}
								animate={{ opacity: 1, y: 0 }}
								exit={{ opacity: 0 }}
								className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400"
							>
								<Check className="h-3.5 w-3.5" />
								Allowance restored
							</motion.span>
						)}
					</AnimatePresence>
					{price !== null && (
						<span className="text-xs text-muted-foreground tabular-nums">
							${price} each
						</span>
					)}
				</div>
			</div>

			<div className="flex flex-wrap items-center gap-x-4 gap-y-3 sm:gap-x-6">
				<div className="w-44 shrink-0">
					<div className="text-base font-semibold tracking-tight tabular-nums">
						{available}{" "}
						<span className="font-normal text-muted-foreground">
							{available === 1 ? "pass" : "passes"} held
						</span>
					</div>
					<div className="mt-0.5 text-xs text-muted-foreground">
						{available > 0 ? breakdown : "None held"}
					</div>
				</div>

				<div
					role="img"
					aria-label={`${available} of ${slots.length} pass slots held`}
					className="flex min-w-0 flex-1 items-center gap-1.5"
				>
					{slots.map((slot, i) => (
						<div
							key={`${slot.kind}-${i}`}
							title={
								slot.filled
									? slot.kind === "included"
										? "Included with your plan this cycle"
										: "Purchased Reset Pass"
									: "Empty pass slot"
							}
							className={
								slot.filled
									? "h-2 w-8 rounded-full bg-foreground transition-colors duration-500"
									: "h-2 w-8 rounded-full border border-border/60 bg-muted"
							}
						/>
					))}
					{overflow > 0 && (
						<span className="text-xs text-muted-foreground tabular-nums">
							+{overflow}
						</span>
					)}
				</div>

				<div className="flex shrink-0 items-center gap-2">
					<Button
						size="sm"
						variant={available === 0 ? "outline" : "default"}
						onClick={() => redeemMutation.mutate({})}
						disabled={
							available === 0 || nothingToReset || redeemMutation.isPending
						}
						title={
							available === 0
								? "No passes held — buy one first"
								: nothingToReset
									? "Nothing to reset yet — your allowance is untouched"
									: undefined
						}
					>
						{redeemMutation.isPending ? (
							<Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
						) : null}
						Use a pass
					</Button>
					{price !== null && (
						<AlertDialog>
							<AlertDialogTrigger asChild>
								<Button
									size="sm"
									variant={available === 0 ? "default" : "outline"}
									disabled={purchaseMutation.isPending}
								>
									{purchaseMutation.isPending ? (
										<Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
									) : null}
									Buy a pass
								</Button>
							</AlertDialogTrigger>
							<AlertDialogContent>
								<AlertDialogHeader>
									<AlertDialogTitle>
										Buy a Reset Pass for ${price}?
									</AlertDialogTitle>
									<AlertDialogDescription>
										Your saved payment method is charged {`$${price} `}now and
										one pass is added to your account. Redeem it anytime to
										restore the weekly premium allowance — it doesn&apos;t add
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
				</div>
			</div>

			<p className="mt-3 text-xs text-muted-foreground">
				Redeeming a pass instantly restores the full{" "}
				{`$${premiumWeeklyLimit.toFixed(2)} `}
				weekly premium allowance. It doesn&apos;t add credits — usage still
				draws from your monthly allowance.
				{includedTotal > 0 && (
					<>
						{" "}
						{tier.charAt(0).toUpperCase() + tier.slice(1)} includes{" "}
						{includedTotal} pass
						{includedTotal === 1 ? "" : "es"} per cycle.
					</>
				)}
			</p>
		</div>
	);
}
