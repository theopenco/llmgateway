"use client";

import { useQuery } from "@tanstack/react-query";
import { CreditCard, Sparkles } from "lucide-react";
import Link from "next/link";

import { useApi } from "@/lib/fetch-client";

import { TopUpCreditsDialog } from "./top-up-credits-dialog";

interface Organization {
	id: string;
	name: string;
	credits: string;
	plan: "free" | "pro" | "enterprise";
}

interface CreditsDisplayProps {
	organization: Organization | null;
	isLoading?: boolean;
}

export function CreditsDisplay({
	organization,
	isLoading,
}: CreditsDisplayProps) {
	const api = useApi();
	const planQuery = useQuery({
		...api.queryOptions("get", "/chat-plans/status"),
		enabled: Boolean(organization),
		staleTime: 30_000,
	});
	const plan = planQuery.data;
	const hasActivePlan = plan && plan.chatPlan !== "none";

	if (isLoading) {
		return (
			<div className="px-2 py-1.5">
				<div className="w-full flex items-center justify-between p-2 rounded-md">
					<div className="flex items-center gap-2">
						<CreditCard className="h-4 w-4 text-muted-foreground" />
						<div className="flex flex-col">
							<span className="text-sm font-medium">Credits</span>
							<span className="text-xs text-muted-foreground">Loading...</span>
						</div>
					</div>
				</div>
			</div>
		);
	}

	const creditsBalance = organization
		? Number(organization.credits).toFixed(2)
		: "0.00";

	const planRemaining = hasActivePlan
		? Number(plan!.chatPlanCreditsRemaining)
		: 0;
	const totalAvailable = Number(creditsBalance) + planRemaining;

	const isLowCredits = organization && totalAvailable < 1;
	const hasNoCredits = organization && totalAvailable <= 0;

	return (
		<div className="px-2 py-1.5">
			{hasActivePlan && plan && (
				<Link
					href="/pricing"
					className="mb-1 block rounded-md border border-emerald-500/20 bg-emerald-500/5 px-2 py-1.5 hover:bg-emerald-500/10 transition-colors"
				>
					<div className="flex items-center justify-between gap-2">
						<div className="flex items-center gap-2 min-w-0">
							<Sparkles className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
							<div className="flex flex-col min-w-0">
								<span className="text-xs font-medium truncate">
									{plan.chatPlan[0].toUpperCase() + plan.chatPlan.slice(1)} plan
								</span>
								<span className="text-[10px] text-muted-foreground tabular-nums">
									${planRemaining.toFixed(2)} of $
									{Number(plan.chatPlanCreditsLimit).toFixed(2)} left
								</span>
							</div>
						</div>
					</div>
				</Link>
			)}
			<TopUpCreditsDialog>
				<button className="w-full flex items-center justify-between p-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors text-left">
					<div className="flex items-center gap-2">
						<CreditCard
							className={`h-4 w-4 ${hasNoCredits ? "text-destructive" : isLowCredits ? "text-yellow-500" : "text-muted-foreground"}`}
						/>
						<div className="flex flex-col">
							<span className="text-sm font-medium">
								{hasActivePlan ? "Pay-as-you-go" : "Credits"}
							</span>
							<span
								className={`text-xs ${hasNoCredits ? "text-destructive" : isLowCredits ? "text-yellow-600" : "text-muted-foreground"}`}
							>
								${creditsBalance}
							</span>
						</div>
					</div>
					<span className="text-xs text-muted-foreground">Add</span>
				</button>
			</TopUpCreditsDialog>
			{!hasActivePlan && (
				<Link
					href="/pricing"
					className="mt-1 block px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
				>
					→ Save with a monthly plan (up to 3× credits)
				</Link>
			)}
			{hasNoCredits && !hasActivePlan && (
				<div className="mt-1 px-2">
					<p className="text-xs text-destructive">⚠️ No credits remaining</p>
				</div>
			)}
			{isLowCredits && !hasNoCredits && !hasActivePlan && (
				<div className="mt-1 px-2">
					<p className="text-xs text-yellow-600">⚡ Low credits remaining</p>
				</div>
			)}
		</div>
	);
}
