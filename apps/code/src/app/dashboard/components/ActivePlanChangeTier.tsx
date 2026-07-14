"use client";

import { ArrowDown, ArrowRight, ArrowUp, Loader2 } from "lucide-react";
import { useState } from "react";

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
import { cn, formatUsageRatio } from "@/lib/utils";

import type { PlanOption, PlanTier } from "@/app/dashboard/types";
import type { paths } from "@/lib/api/v1";

interface ActivePlanChangeTierProps {
	plans: PlanOption[];
	currentPlan: PlanTier | "none" | null;
	pendingTier: PlanTier | null;
	cancelled: boolean;
	subscribingTier: PlanTier | null;
	isCancellingDowngrade: boolean;
	onChangeTier: (tier: PlanTier, expectedAmountDueCents?: number) => void;
	onCancelDowngrade: () => void;
}

type TierChangePreview =
	paths["/dev-plans/change-tier-preview"]["post"]["responses"]["200"]["content"]["application/json"];

const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
});

const usageFormatter = new Intl.NumberFormat("en-US", {
	maximumFractionDigits: 2,
	minimumFractionDigits: 0,
});

function formatCurrencyFromCents(cents: number) {
	return currencyFormatter.format(cents / 100);
}

function formatUsageAmount(amount: number) {
	return `$${usageFormatter.format(amount)}`;
}

export default function ActivePlanChangeTier({
	plans,
	currentPlan,
	pendingTier,
	cancelled,
	subscribingTier,
	isCancellingDowngrade,
	onChangeTier,
	onCancelDowngrade,
}: ActivePlanChangeTierProps) {
	const currentPrice = plans.find((p) => p.tier === currentPlan)?.price ?? 0;
	const currentName =
		plans.find((p) => p.tier === currentPlan)?.name ?? "your plan";
	const pendingName = plans.find((p) => p.tier === pendingTier)?.name ?? null;
	// A scheduled downgrade doesn't lock the plan: the user can still upgrade to a
	// higher tier, or cancel the downgrade to stay on their current tier.
	const hasPendingDowngrade = pendingTier !== null;

	return (
		<div>
			<h2 className="mb-1 font-semibold">Change plan</h2>
			<p className="mb-4 text-sm text-muted-foreground">
				{cancelled
					? "Your subscription is scheduled to cancel. Resume it first to change your plan."
					: hasPendingDowngrade && pendingName
						? `You're scheduled to move to ${pendingName} at your next renewal. You can still upgrade, or cancel the scheduled downgrade to keep ${currentName}.`
						: "Upgrades take effect immediately; downgrades apply at your next renewal."}
			</p>
			<div className="grid gap-4 md:grid-cols-3">
				{plans.map((plan) => {
					const isCurrent = currentPlan === plan.tier;
					const isScheduled = pendingTier === plan.tier;
					const isUpgrade = plan.price > currentPrice;
					const isPending = subscribingTier === plan.tier;
					const ratioLabel = formatUsageRatio(plan.usage, plan.price);

					return (
						<div
							key={plan.tier}
							className={cn(
								"flex flex-col rounded-xl border p-5 transition-shadow",
								isCurrent
									? "border-foreground/20 ring-1 ring-foreground/5"
									: "hover:shadow-sm",
							)}
						>
							<div className="mb-3 flex items-center justify-between">
								<span className="font-medium">{plan.name}</span>
								{isCurrent ? (
									<span className="rounded-md bg-foreground/10 px-2 py-0.5 text-[11px] font-medium">
										Current
									</span>
								) : isScheduled ? (
									<span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
										Scheduled
									</span>
								) : (
									<span
										className={cn(
											"inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
											isUpgrade
												? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
												: "bg-muted text-muted-foreground",
										)}
									>
										{isUpgrade ? (
											<ArrowUp className="h-2.5 w-2.5" />
										) : (
											<ArrowDown className="h-2.5 w-2.5" />
										)}
										{isUpgrade ? "Upgrade" : "Downgrade"}
									</span>
								)}
							</div>
							<div className="mb-1 flex items-baseline gap-1">
								<span className="text-2xl font-bold">${plan.price}</span>
								<span className="text-sm text-muted-foreground">/mo</span>
							</div>
							<div className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground">
								<span className="rounded-full bg-foreground/10 px-2 py-0.5 font-semibold tabular-nums text-foreground">
									{ratioLabel} usage value
								</span>
							</div>
							{isScheduled ? (
								<p className="mt-auto text-xs text-muted-foreground">
									Takes effect at your next renewal.
								</p>
							) : isCurrent ? (
								hasPendingDowngrade ? (
									<Button
										className="mt-auto w-full"
										variant="outline"
										size="sm"
										disabled={isCancellingDowngrade}
										onClick={onCancelDowngrade}
									>
										{isCancellingDowngrade ? (
											<Loader2 className="h-4 w-4 animate-spin" />
										) : (
											`Keep ${plan.name}`
										)}
									</Button>
								) : null
							) : (
								<TierChangeDialog
									plan={plan}
									currentName={currentName}
									isUpgrade={isUpgrade}
									isPending={isPending}
									// A cancelling subscription must be resumed before any tier
									// change. A pending downgrade blocks scheduling another
									// downgrade, but upgrades are still allowed (they supersede it).
									disabled={cancelled || (hasPendingDowngrade && !isUpgrade)}
									onChangeTier={onChangeTier}
								/>
							)}
						</div>
					);
				})}
			</div>
			{cancelled && (
				<p className="mt-4 text-sm text-muted-foreground">
					Resume your subscription above to upgrade or downgrade your plan.
				</p>
			)}
		</div>
	);
}

function TierChangeDialog({
	plan,
	currentName,
	isUpgrade,
	isPending,
	disabled,
	onChangeTier,
}: {
	plan: PlanOption;
	currentName: string;
	isUpgrade: boolean;
	isPending: boolean;
	disabled?: boolean;
	onChangeTier: (tier: PlanTier, expectedAmountDueCents?: number) => void;
}) {
	const api = useApi();
	const [open, setOpen] = useState(false);
	const {
		data: preview,
		isLoading,
		isFetching,
		isError,
	} = api.useQuery(
		"post",
		"/dev-plans/change-tier-preview",
		{
			body: {
				newTier: plan.tier,
			},
		},
		{
			enabled: open,
			refetchOnWindowFocus: false,
			staleTime: 0,
		},
	);
	const isPreviewLoading = isLoading || isFetching;
	const canConfirm = !isPending && !!preview && !isPreviewLoading && !isError;

	return (
		<AlertDialog open={open} onOpenChange={setOpen}>
			<AlertDialogTrigger asChild>
				<Button
					className="mt-auto w-full"
					variant="outline"
					size="sm"
					disabled={isPending || disabled}
				>
					{isPending ? (
						<Loader2 className="h-4 w-4 animate-spin" />
					) : (
						<>
							Switch to {plan.name}
							<ArrowRight className="ml-1 h-3.5 w-3.5" />
						</>
					)}
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{isUpgrade ? `Upgrade to ${plan.name}?` : `Switch to ${plan.name}?`}
					</AlertDialogTitle>
					<AlertDialogDescription>
						<TierChangePreviewCopy
							plan={plan}
							currentName={currentName}
							isUpgrade={isUpgrade}
							preview={preview}
							isLoading={isPreviewLoading}
							isError={isError}
						/>
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Keep {currentName}</AlertDialogCancel>
					<AlertDialogAction
						disabled={!canConfirm}
						onClick={() => {
							if (!preview) {
								return;
							}
							onChangeTier(plan.tier, preview.amountDueCents);
						}}
					>
						{isPending && (
							<Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
						)}
						{isUpgrade ? `Pay and upgrade` : `Switch to ${plan.name}`}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function TierChangePreviewCopy({
	plan,
	currentName,
	isUpgrade,
	preview,
	isLoading,
	isError,
}: {
	plan: PlanOption;
	currentName: string;
	isUpgrade: boolean;
	preview: TierChangePreview | undefined;
	isLoading: boolean;
	isError: boolean;
}) {
	if (isLoading) {
		return (
			<span className="inline-flex items-center gap-2">
				<Loader2 className="h-3.5 w-3.5 animate-spin" />
				Calculating today&apos;s charge...
			</span>
		);
	}

	if (isError || !preview) {
		return (
			<span>
				We couldn&apos;t calculate the exact amount due. Close this dialog and
				try again before changing plans.
			</span>
		);
	}

	if (isUpgrade) {
		return (
			<span>
				You&apos;ll be charged{" "}
				<strong>{formatCurrencyFromCents(preview.amountDueCents)}</strong> today
				and your billing period restarts now, then ${plan.price}/mo going
				forward. Your allowance resets to{" "}
				{formatUsageAmount(preview.newCreditsLimit)} in usage for the new
				period, and any unspent credits from your current period aren&apos;t
				rolled over.
			</span>
		);
	}

	return (
		<span>
			You&apos;ll keep your {currentName} allowance until the end of your
			current billing period, when you&apos;ll move to {plan.name} ($
			{plan.price}/mo, ${plan.usage} in usage) at your next renewal. The
			downgrade only takes effect at renewal, and until then you won&apos;t be
			able to upgrade or change your plan. No refund is issued for the current
			period and no charge is due today.
		</span>
	);
}
