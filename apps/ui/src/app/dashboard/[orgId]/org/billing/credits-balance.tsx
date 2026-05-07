"use client";

import { AlertCircle, CheckCircle, Clock, CreditCard } from "lucide-react";
import { usePostHog } from "posthog-js/react";
import { useEffect, useRef } from "react";

import { Button } from "@/lib/components/button";
import { useDashboardState } from "@/lib/dashboard-state";
import { useApi } from "@/lib/fetch-client";

export function CreditsBalance() {
	const { selectedOrganization } = useDashboardState();
	const api = useApi();
	const posthog = usePostHog();
	const tracked = useRef(false);

	const { data: runwayData } = api.useQuery(
		"get",
		"/orgs/{id}/credits-runway",
		{ params: { path: { id: selectedOrganization?.id ?? "" } } },
		{ enabled: !!selectedOrganization?.id },
	);

	useEffect(() => {
		if (runwayData && !tracked.current) {
			tracked.current = true;
			const bucket =
				runwayData.runwayDays === null
					? "no_usage"
					: runwayData.runwayDays > 30
						? "30+"
						: runwayData.runwayDays > 14
							? "14+"
							: runwayData.runwayDays >= 3
								? "3-14"
								: "0-3";
			posthog.capture("runway_display_viewed", { runway_bucket: bucket });
		}
	}, [runwayData, posthog]);

	if (!selectedOrganization) {
		return (
			<div className="flex items-center justify-center p-8">
				<div className="flex items-center gap-2 text-muted-foreground">
					<CreditCard className="h-5 w-5" />
					<span>Loading credits...</span>
				</div>
			</div>
		);
	}

	const creditsBalance = Number(selectedOrganization.credits);
	const formattedBalance = creditsBalance.toFixed(2);

	const isLowCredits = creditsBalance < 1;
	const hasNoCredits = creditsBalance <= 0;

	const runwayDays = runwayData?.runwayDays ?? null;
	const avgDailySpend = runwayData?.avgDailySpend7d ?? 0;
	const hasUsage = avgDailySpend > 0;

	const runwayColor =
		runwayDays === null
			? "text-muted-foreground"
			: runwayDays > 14
				? "text-green-600"
				: runwayDays >= 3
					? "text-yellow-600"
					: "text-destructive";

	const runwayLabel = !hasUsage
		? "No recent usage"
		: runwayDays !== null && runwayDays > 30
			? "30+ days of credits remaining"
			: runwayDays !== null
				? `~${runwayDays} day${runwayDays !== 1 ? "s" : ""} of credits remaining at your current usage`
				: null;

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between p-6 border rounded-lg bg-muted/50">
				<div className="flex items-center gap-4">
					<div
						className={`p-3 rounded-full ${
							hasNoCredits
								? "bg-destructive/10"
								: isLowCredits
									? "bg-yellow-500/10"
									: "bg-green-500/10"
						}`}
					>
						<CreditCard
							className={`h-6 w-6 ${
								hasNoCredits
									? "text-destructive"
									: isLowCredits
										? "text-yellow-600"
										: "text-green-600"
							}`}
						/>
					</div>
					<div>
						<p className="text-sm text-muted-foreground font-medium">
							Available Balance
						</p>
						<p className="text-3xl font-bold">${formattedBalance}</p>
						{runwayLabel && (
							<div className={`flex items-center gap-1 mt-1 ${runwayColor}`}>
								<Clock className="h-3.5 w-3.5" />
								<p className="text-sm">{runwayLabel}</p>
							</div>
						)}
					</div>
				</div>
				{runwayDays !== null && runwayDays < 3 && hasUsage && (
					<Button size="sm" asChild>
						<a href="#top-up">Top up now</a>
					</Button>
				)}
			</div>

			{hasNoCredits && (
				<div className="flex items-start gap-2 p-4 border border-destructive/50 rounded-lg bg-destructive/5">
					<AlertCircle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
					<div>
						<p className="font-medium text-destructive">No credits remaining</p>
						<p className="text-sm text-muted-foreground mt-1">
							Your credit balance is empty. Top up now to continue using the
							service.
						</p>
					</div>
				</div>
			)}

			{isLowCredits && !hasNoCredits && (
				<div className="flex items-start gap-2 p-4 border border-yellow-500/50 rounded-lg bg-yellow-500/5">
					<AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5 flex-shrink-0" />
					<div>
						<p className="font-medium text-yellow-700">Low credits</p>
						<p className="text-sm text-muted-foreground mt-1">
							Your credit balance is running low. Consider topping up to avoid
							service interruption.
						</p>
					</div>
				</div>
			)}

			{!isLowCredits && !hasNoCredits && (
				<div className="flex items-start gap-2 p-4 border border-green-500/50 rounded-lg bg-green-500/5">
					<CheckCircle className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
					<div>
						<p className="font-medium text-green-700">Healthy balance</p>
						<p className="text-sm text-muted-foreground mt-1">
							Your credit balance is sufficient for continued service.
						</p>
					</div>
				</div>
			)}
		</div>
	);
}
