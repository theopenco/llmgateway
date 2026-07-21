"use client";

import { format } from "date-fns";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useApi } from "@/lib/fetch-client";
import { cn, formatUsageRatio } from "@/lib/utils";

import type { PlanOption, PlanTier } from "@/app/dashboard/types";
import type { paths } from "@/lib/api/v1";

export type TierChangeTiming = "now" | "next_cycle";

interface ActivePlanChangeTierProps {
	plans: PlanOption[];
	currentPlan: PlanTier | "none" | null;
	pendingTier: PlanTier | null;
	cancelled: boolean;
	subscribingTier: PlanTier | null;
	isCancellingDowngrade: boolean;
	onChangeTier: (
		tier: PlanTier,
		expectedAmountDueCents?: number,
		timing?: TierChangeTiming,
	) => void;
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
	// A scheduled tier change doesn't lock the plan: the user can still upgrade
	// immediately (superseding it), or cancel the change to stay on their
	// current tier.
	const hasPendingChange = pendingTier !== null;

	return (
		<div>
			<h2 className="mb-1 font-semibold">Change plan</h2>
			<p className="mb-4 text-sm text-muted-foreground">
				{cancelled
					? "Your subscription is scheduled to cancel. Resume it first to change your plan."
					: hasPendingChange && pendingName
						? `You're scheduled to move to ${pendingName} at your next renewal. You can still upgrade immediately, or cancel the scheduled change to keep ${currentName}.`
						: "Upgrades take effect immediately or at your next renewal — your choice; downgrades apply at your next renewal. Selecting a plan won't change anything yet: you'll review the details and confirm before any payment is made."}
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
								hasPendingChange ? (
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
									hasPendingChange={hasPendingChange}
									// A cancelling subscription must be resumed before any tier
									// change. A pending change blocks scheduling another one, but
									// immediate upgrades are still allowed (they supersede it).
									disabled={cancelled || (hasPendingChange && !isUpgrade)}
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
	hasPendingChange,
	disabled,
	onChangeTier,
}: {
	plan: PlanOption;
	currentName: string;
	isUpgrade: boolean;
	isPending: boolean;
	hasPendingChange: boolean;
	disabled?: boolean;
	onChangeTier: (
		tier: PlanTier,
		expectedAmountDueCents?: number,
		timing?: TierChangeTiming,
	) => void;
}) {
	const api = useApi();
	const [open, setOpen] = useState(false);
	const [timing, setTiming] = useState<TierChangeTiming>("now");
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
	// A pending change must be superseded (immediate upgrade) or cancelled
	// before another change can be scheduled, so hide the schedule option then.
	const showTimingChoice = isUpgrade && !hasPendingChange;

	return (
		<AlertDialog
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (next) {
					setTiming("now");
				}
			}}
		>
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
							showTimingChoice={showTimingChoice}
							preview={preview}
							isLoading={isPreviewLoading}
							isError={isError}
						/>
					</AlertDialogDescription>
				</AlertDialogHeader>
				{showTimingChoice && preview && !isPreviewLoading && !isError && (
					<UpgradeTimingChoice
						plan={plan}
						currentName={currentName}
						preview={preview}
						timing={timing}
						onTimingChange={setTiming}
					/>
				)}
				<AlertDialogFooter>
					<AlertDialogCancel>Keep {currentName}</AlertDialogCancel>
					<AlertDialogAction
						disabled={!canConfirm}
						onClick={() => {
							if (!preview) {
								return;
							}
							// Downgrades are always deferred to renewal server-side, so
							// report them as next_cycle for an accurate confirmation toast.
							const effectiveTiming: TierChangeTiming = !isUpgrade
								? "next_cycle"
								: showTimingChoice
									? timing
									: "now";
							onChangeTier(
								plan.tier,
								effectiveTiming === "now" ? preview.amountDueCents : undefined,
								effectiveTiming,
							);
						}}
					>
						{isPending && (
							<Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
						)}
						{!isUpgrade
							? `Switch to ${plan.name}`
							: showTimingChoice && timing === "next_cycle"
								? `Schedule upgrade`
								: `Pay and upgrade`}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function formatRenewalDate(iso: string): string | null {
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? null : format(date, "MMM d, yyyy");
}

// Shared between the timing chooser and the fallback preview copy so the
// rollover explanation can't drift between the two.
function RolloverAllowanceCopy({
	plan,
	preview,
}: {
	plan: PlanOption;
	preview: TierChangePreview;
}) {
	if (preview.rolloverCredits > 0) {
		return (
			<>
				Your allowance for the new period is{" "}
				<strong>{formatUsageAmount(preview.newCreditsLimit)}</strong>: the{" "}
				{plan.name} allowance of ${plan.usage} plus{" "}
				<strong>{formatUsageAmount(preview.rolloverCredits)}</strong> of unspent
				credits rolled over from your current period. Rolled-over credits last
				until your next renewal.
			</>
		);
	}
	return (
		<>
			Your allowance resets to{" "}
			<strong>{formatUsageAmount(preview.newCreditsLimit)}</strong> in usage for
			the new period.
		</>
	);
}

function UpgradeTimingChoice({
	plan,
	currentName,
	preview,
	timing,
	onTimingChange,
}: {
	plan: PlanOption;
	currentName: string;
	preview: TierChangePreview;
	timing: TierChangeTiming;
	onTimingChange: (timing: TierChangeTiming) => void;
}) {
	const renewalDate = formatRenewalDate(preview.billingPeriodEnd);

	return (
		<RadioGroup
			value={timing}
			onValueChange={(value) => onTimingChange(value as TierChangeTiming)}
			className="gap-2"
		>
			<label
				htmlFor="upgrade-timing-now"
				className={cn(
					"flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition-colors",
					timing === "now"
						? "border-foreground/30 bg-muted/40"
						: "hover:bg-muted/20",
				)}
			>
				<RadioGroupItem
					value="now"
					id="upgrade-timing-now"
					className="mt-0.5"
				/>
				<span className="flex flex-col gap-1">
					<span className="text-sm font-medium">Upgrade now</span>
					<span className="text-xs text-muted-foreground">
						<strong>{formatCurrencyFromCents(preview.amountDueCents)}</strong>{" "}
						charged today and your billing period restarts, then ${plan.price}
						/mo going forward.{" "}
						<RolloverAllowanceCopy plan={plan} preview={preview} />
					</span>
				</span>
			</label>
			<label
				htmlFor="upgrade-timing-next-cycle"
				className={cn(
					"flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition-colors",
					timing === "next_cycle"
						? "border-foreground/30 bg-muted/40"
						: "hover:bg-muted/20",
				)}
			>
				<RadioGroupItem
					value="next_cycle"
					id="upgrade-timing-next-cycle"
					className="mt-0.5"
				/>
				<span className="flex flex-col gap-1">
					<span className="text-sm font-medium">
						At next renewal{renewalDate ? ` — ${renewalDate}` : ""}
					</span>
					<span className="text-xs text-muted-foreground">
						No charge today. You keep your {currentName} allowance until{" "}
						{renewalDate ?? "your next renewal"}, then move to {plan.name} ($
						{plan.price}/mo, ${plan.usage} in usage). Unspent credits don&apos;t
						carry over at renewal.
					</span>
				</span>
			</label>
		</RadioGroup>
	);
}

function TierChangePreviewCopy({
	plan,
	currentName,
	isUpgrade,
	showTimingChoice,
	preview,
	isLoading,
	isError,
}: {
	plan: PlanOption;
	currentName: string;
	isUpgrade: boolean;
	showTimingChoice: boolean;
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

	if (showTimingChoice) {
		return <span>Choose when the upgrade takes effect.</span>;
	}

	if (isUpgrade) {
		return (
			<span>
				You&apos;ll be charged{" "}
				<strong>{formatCurrencyFromCents(preview.amountDueCents)}</strong> today
				and your billing period restarts now, then ${plan.price}/mo going
				forward. <RolloverAllowanceCopy plan={plan} preview={preview} />
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
