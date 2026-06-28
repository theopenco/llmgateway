"use client";

import { useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNowStrict } from "date-fns";
import { Info, Loader2 } from "lucide-react";
import dynamic from "next/dynamic";
import { usePostHog } from "posthog-js/react";
import { useState } from "react";
import { toast } from "sonner";

import { plans } from "@/app/dashboard/plans";
import { useDevPlanStatus } from "@/app/dashboard/useDevPlanStatus";
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
import { Skeleton } from "@/components/ui/skeleton";
import { useAppConfig } from "@/lib/config";
import { useApi } from "@/lib/fetch-client";

import type { PlanTier } from "@/app/dashboard/types";
import type { DevPlanStatus } from "@/app/dashboard/useDevPlanStatus";
import type { paths } from "@/lib/api/v1";

type PaymentMethod =
	paths["/dev-plans/payment-method"]["get"]["responses"]["200"]["content"]["application/json"];

const ActivePlanChangeTier = dynamic(
	() => import("@/app/dashboard/components/ActivePlanChangeTier"),
);

const DevPassPaymentMethod = dynamic(
	() => import("@/app/dashboard/components/DevPassPaymentMethod"),
);

const DevPassBillingDetails = dynamic(
	() => import("@/app/dashboard/components/DevPassBillingDetails"),
);

const DevPassInvoices = dynamic(
	() => import("@/app/dashboard/components/DevPassInvoices"),
);

interface BillingClientProps {
	initialDevPlanStatus?: DevPlanStatus | null;
	initialPaymentMethod?: PaymentMethod | null;
}

export default function BillingClient({
	initialDevPlanStatus,
	initialPaymentMethod,
}: BillingClientProps) {
	const config = useAppConfig();
	const { posthogKey } = config;
	const posthog = usePostHog();
	const api = useApi();
	const queryClient = useQueryClient();

	const { data: devPlanStatus } = useDevPlanStatus(initialDevPlanStatus);

	const invalidateInvoices = () =>
		queryClient.invalidateQueries({
			predicate: (query) => {
				const key = query.queryKey;
				return Array.isArray(key) && key[1] === "/dev-plans/invoices";
			},
		});

	const cancelMutation = api.useMutation("post", "/dev-plans/cancel");
	const resumeMutation = api.useMutation("post", "/dev-plans/resume");
	const changeTierMutation = api.useMutation("post", "/dev-plans/change-tier");

	const [subscribingTier, setSubscribingTier] = useState<PlanTier | null>(null);
	const [isCancelling, setIsCancelling] = useState(false);
	const [isResuming, setIsResuming] = useState(false);

	const handleChangeTier = async (
		newTier: PlanTier,
		expectedAmountDueCents?: number,
	): Promise<void> => {
		// Cycle is intentionally not sent — the server preserves the existing
		// monthly/annual cadence by reading it from the org's stored devPlanCycle
		// and looks up the matching annual or monthly Stripe price ID.
		setSubscribingTier(newTier);
		try {
			await changeTierMutation.mutateAsync({
				body: { newTier, expectedAmountDueCents },
			});
			// An upgrade records a new dev_plan_upgrade invoice server-side; refetch
			// so the Invoices section reflects the just-paid charge immediately.
			await invalidateInvoices();
			if (posthogKey) {
				posthog.capture("dev_plan_tier_changed", { newTier });
			}
			toast.success("Plan updated");
		} catch {
			toast.error("Failed to change plan");
		} finally {
			setSubscribingTier(null);
		}
	};

	const handleCancel = async (): Promise<void> => {
		setIsCancelling(true);
		try {
			await cancelMutation.mutateAsync({});
			if (posthogKey) {
				posthog.capture("dev_plan_cancelled");
			}
			toast.success("Subscription cancelled", {
				description:
					"Your plan will remain active until the end of your billing period.",
			});
		} catch {
			toast.error("Failed to cancel subscription");
		} finally {
			setIsCancelling(false);
		}
	};

	const handleResume = async (): Promise<void> => {
		setIsResuming(true);
		try {
			await resumeMutation.mutateAsync({});
			if (posthogKey) {
				posthog.capture("dev_plan_resumed");
			}
			toast.success("Subscription resumed");
		} catch {
			toast.error("Failed to resume subscription");
		} finally {
			setIsResuming(false);
		}
	};

	if (!devPlanStatus) {
		return <BillingSkeleton />;
	}

	const currentPlan = devPlanStatus.devPlan ?? null;
	const currentPlanData = plans.find((p) => p.tier === currentPlan);
	const cycle = devPlanStatus.devPlanCycle ?? "monthly";
	const cancelled = devPlanStatus.devPlanCancelled ?? false;
	const billingCycleStart = devPlanStatus.devPlanBillingCycleStart ?? null;

	const renewalHint = (() => {
		if (!billingCycleStart) {
			return "—";
		}
		const renewAt = new Date(billingCycleStart);
		if (cycle === "annual") {
			renewAt.setFullYear(renewAt.getFullYear() + 1);
		} else {
			renewAt.setMonth(renewAt.getMonth() + 1);
		}
		const when = format(renewAt, "MMM d, yyyy");
		return cancelled
			? `Ends ${when}`
			: `Renews ${when} (in ${formatDistanceToNowStrict(renewAt)})`;
	})();

	return (
		<div className="space-y-10">
			<div>
				<h1 className="text-lg font-semibold tracking-tight">Billing</h1>
				<p className="mt-0.5 text-sm text-muted-foreground">
					Manage your DevPass subscription and plan.
				</p>
			</div>

			{/* Current subscription summary */}
			<div className="rounded-xl border bg-card p-6">
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div>
						<div className="flex items-center gap-2">
							<h2 className="font-semibold">
								{currentPlanData?.name ?? "DevPass"} plan
							</h2>
							<span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground capitalize">
								{cycle}
							</span>
							{cancelled && (
								<span className="rounded-md bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
									Cancelling
								</span>
							)}
						</div>
						<p className="mt-1 text-sm text-muted-foreground">
							${currentPlanData?.price ?? 0}/mo · ${currentPlanData?.usage ?? 0}{" "}
							in monthly usage
						</p>
						<p className="mt-0.5 text-xs text-muted-foreground">
							{renewalHint}
						</p>
					</div>

					{cancelled ? (
						<Button
							variant="outline"
							size="sm"
							onClick={handleResume}
							disabled={isResuming}
						>
							{isResuming && (
								<Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
							)}
							Resume subscription
						</Button>
					) : (
						<AlertDialog>
							<AlertDialogTrigger asChild>
								<Button
									variant="ghost"
									size="sm"
									disabled={isCancelling}
									className="text-muted-foreground"
								>
									{isCancelling && (
										<Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
									)}
									Cancel subscription
								</Button>
							</AlertDialogTrigger>
							<AlertDialogContent>
								<AlertDialogHeader>
									<AlertDialogTitle>Cancel your Dev Plan?</AlertDialogTitle>
									<AlertDialogDescription>
										Your plan stays active until the end of the current billing
										period. You won&apos;t be charged again, and you can resume
										any time before then.
									</AlertDialogDescription>
								</AlertDialogHeader>
								<AlertDialogFooter>
									<AlertDialogCancel>Keep subscription</AlertDialogCancel>
									<AlertDialogAction onClick={handleCancel}>
										Cancel subscription
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
					)}
				</div>

				{/* Clarify DevPass vs pay-as-you-go billing */}
				<div className="mt-5 flex gap-3 rounded-lg border border-border/60 bg-muted/40 p-3.5">
					<Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
					<p className="text-xs leading-relaxed text-muted-foreground">
						Your DevPass subscription is billed separately from LLM Gateway
						pay-as-you-go credits, so it won&apos;t appear in the standard LLM
						Gateway billing dashboard. Manage the plan and payment method for
						DevPass right here.
					</p>
				</div>
			</div>

			{/* Payment method */}
			<DevPassPaymentMethod initialData={initialPaymentMethod} />

			{/* Change plan */}
			<ActivePlanChangeTier
				plans={plans}
				currentPlan={currentPlan}
				subscribingTier={subscribingTier}
				onChangeTier={handleChangeTier}
			/>

			{/* Past invoices */}
			<DevPassInvoices />

			{/* Billing details (invoice details) */}
			<DevPassBillingDetails />
		</div>
	);
}

function BillingSkeleton() {
	return (
		<div className="space-y-10">
			<div className="space-y-2">
				<Skeleton className="h-6 w-24" />
				<Skeleton className="h-4 w-72" />
			</div>

			<div className="rounded-xl border bg-card p-6">
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div className="space-y-2">
						<Skeleton className="h-5 w-40" />
						<Skeleton className="h-4 w-56" />
						<Skeleton className="h-3 w-48" />
					</div>
					<Skeleton className="h-8 w-36" />
				</div>
				<Skeleton className="mt-5 h-16 w-full rounded-lg" />
			</div>

			<div className="rounded-xl border bg-card p-6">
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div className="space-y-2">
						<Skeleton className="h-5 w-36" />
						<Skeleton className="h-4 w-64" />
					</div>
					<Skeleton className="h-8 w-24" />
				</div>
				<Skeleton className="mt-5 h-16 w-full rounded-lg" />
			</div>

			<div className="space-y-4">
				<Skeleton className="h-5 w-28" />
				<div className="grid gap-4 md:grid-cols-3">
					{Array.from({ length: 3 }).map((_, i) => (
						<Skeleton key={i} className="h-44 w-full rounded-xl" />
					))}
				</div>
			</div>
		</div>
	);
}
