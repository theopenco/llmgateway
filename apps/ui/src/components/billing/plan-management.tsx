import { useQueryClient } from "@tanstack/react-query";

import { UpgradeToProDialog } from "@/components/shared/upgrade-to-pro-dialog";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { useToast } from "@/lib/components/use-toast";
import { useDashboardContext } from "@/lib/dashboard-context";
import { useApi } from "@/lib/fetch-client";

export function PlanManagement() {
	const { selectedOrganization } = useDashboardContext();
	const { toast } = useToast();
	const queryClient = useQueryClient();
	const api = useApi();

	const { data: subscriptionStatus } = api.useQuery(
		"get",
		"/subscriptions/status",
	);

	const cancelSubscriptionMutation = api.useMutation(
		"post",
		"/subscriptions/cancel-pro-subscription",
	);

	const resumeSubscriptionMutation = api.useMutation(
		"post",
		"/subscriptions/resume-pro-subscription",
	);

	const upgradeToYearlyMutation = api.useMutation(
		"post",
		"/subscriptions/upgrade-to-yearly",
	);

	const handleCancelSubscription = async () => {
		const isInTrial = subscriptionStatus?.isTrialActive;
		const confirmMessage = isInTrial
			? "Are you sure you want to cancel your trial? You'll immediately lose access to Pro features and won't be charged."
			: "Are you sure you want to cancel your Pro subscription? You'll lose access to provider keys at the end of your billing period.";

		const confirmed = window.confirm(confirmMessage);

		if (!confirmed) {
			return;
		}

		try {
			await cancelSubscriptionMutation.mutateAsync({});
			await queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/subscriptions/status").queryKey,
			});
			const isInTrial = subscriptionStatus?.isTrialActive;
			toast({
				title: isInTrial ? "Trial Canceled" : "Subscription Canceled",
				description: isInTrial
					? "Your Pro trial has been canceled. You've been switched back to the free plan."
					: "Your Pro subscription has been canceled. You'll retain access until the end of your billing period.",
			});
		} catch (error) {
			toast({
				title: "Error",
				description: `Failed to cancel subscription. Please try again. Error: ${error}`,
				variant: "destructive",
			});
		}
	};

	const handleResumeSubscription = async () => {
		const confirmed = window.confirm(
			"Are you sure you want to resume your Pro subscription? Your subscription will continue and you'll be charged at the next billing cycle.",
		);

		if (!confirmed) {
			return;
		}

		try {
			await resumeSubscriptionMutation.mutateAsync({});
			await queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/subscriptions/status").queryKey,
			});
			toast({
				title: "Subscription Resumed",
				description:
					"Your Pro subscription has been resumed. You'll continue to have access to all Pro features.",
			});
		} catch (error) {
			toast({
				title: "Error",
				description: `Failed to resume subscription. Please try again. Error: ${error}`,
				variant: "destructive",
			});
		}
	};

	const handleUpgradeToYearly = async () => {
		const confirmed = window.confirm(
			"Are you sure you want to upgrade to the yearly plan? You'll be charged a prorated amount for the remaining time and save money on future billing cycles.",
		);

		if (!confirmed) {
			return;
		}

		try {
			await upgradeToYearlyMutation.mutateAsync({});
			await queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/subscriptions/status").queryKey,
			});
			toast({
				title: "Upgraded to Yearly",
				description:
					"Your subscription has been upgraded to yearly billing. You'll save money on future billing cycles!",
			});
		} catch (error) {
			toast({
				title: "Error",
				description: `Failed to upgrade to yearly plan. Please try again. Error: ${error}`,
				variant: "destructive",
			});
		}
	};

	if (!selectedOrganization) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Plan & Billing</CardTitle>
					<CardDescription>Loading plan information...</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	const isProPlan = selectedOrganization.plan === "pro";
	const planExpiresAt = selectedOrganization.planExpiresAt
		? new Date(selectedOrganization.planExpiresAt)
		: null;

	// Trial information
	const isTrialActive = subscriptionStatus?.isTrialActive || false;
	const trialEndDate = subscriptionStatus?.trialEndDate
		? new Date(subscriptionStatus.trialEndDate)
		: null;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Plan & Billing</CardTitle>
				<CardDescription>
					Manage your subscription and billing preferences
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				<div className="flex items-center justify-between">
					<div>
						<div className="flex items-center gap-2">
							<h3 className="text-lg font-medium">Current Plan</h3>
							<Badge variant={isProPlan ? "default" : "secondary"}>
								{isProPlan ? "Pro" : "Free"}
							</Badge>
							{isTrialActive && <Badge variant="destructive">Free Trial</Badge>}
							{isProPlan &&
								subscriptionStatus?.billingCycle &&
								!isTrialActive && (
									<Badge variant="outline">
										{subscriptionStatus.billingCycle === "yearly"
											? "Yearly"
											: "Monthly"}
									</Badge>
								)}
						</div>
						<p className="text-sm text-muted-foreground mt-1">
							{isTrialActive
								? "You're currently on a free trial with full Pro features"
								: isProPlan
									? "Access to provider keys and all features"
									: "Limited to credits-based usage only"}
						</p>
						{isTrialActive && trialEndDate && (
							<p className="text-sm text-amber-600 font-medium mt-1">
								Trial ends on {trialEndDate.toDateString()}
							</p>
						)}
						{planExpiresAt && !isTrialActive && (
							<p className="text-sm text-muted-foreground mt-1">
								{subscriptionStatus?.subscriptionCancelled
									? `Expires on ${planExpiresAt.toDateString()}`
									: `Renews on ${planExpiresAt.toDateString()}`}
							</p>
						)}
					</div>
					<div className="text-right">
						<p className="text-2xl font-bold">
							{isTrialActive
								? "$0"
								: isProPlan
									? subscriptionStatus?.billingCycle === "yearly"
										? "$500"
										: "$50"
									: "$0"}
							<span className="text-sm font-normal text-muted-foreground">
								{isTrialActive
									? "/trial"
									: isProPlan
										? subscriptionStatus?.billingCycle === "yearly"
											? "/year"
											: "/month"
										: "/month"}
							</span>
						</p>
						{isTrialActive && (
							<p className="text-sm text-amber-600 font-medium">
								Then $
								{subscriptionStatus?.billingCycle === "yearly"
									? "500/year"
									: "50/month"}
							</p>
						)}
						{isProPlan &&
							subscriptionStatus?.billingCycle === "yearly" &&
							!isTrialActive && (
								<p className="text-sm text-green-600 font-medium">
									Save 20% vs monthly
								</p>
							)}
					</div>
				</div>

				{isTrialActive && trialEndDate && (
					<div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-2">
						<div className="flex items-center gap-2">
							<div className="w-2 h-2 rounded-full bg-amber-500" />
							<h4 className="font-medium text-amber-800">Free Trial Active</h4>
						</div>
						<p className="text-sm text-amber-700">
							You're enjoying full Pro features at no cost until{" "}
							{trialEndDate.toDateString()}. After the trial ends, you'll be
							charged $
							{subscriptionStatus?.billingCycle === "yearly"
								? "$500/year"
								: "$50/month"}
							.
						</p>
						<p className="text-xs text-amber-600">
							You can cancel anytime before your trial ends to avoid charges.
						</p>
					</div>
				)}

				<div className="border rounded-lg p-4 space-y-3">
					<h4 className="font-medium">Plan Features</h4>
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
						<div className="space-y-2">
							<div className="flex items-center gap-2">
								<div
									className={`w-2 h-2 rounded-full ${
										isProPlan ? "bg-green-500" : "bg-gray-300"
									}`}
								/>
								<span>Provider API Keys</span>
								{!isProPlan && (
									<Badge variant="outline" className="text-xs">
										Pro Only
									</Badge>
								)}
							</div>
							<div className="flex items-center gap-2">
								<div className="w-2 h-2 rounded-full bg-green-500" />
								<span>90-day data retention</span>
							</div>
						</div>
						<div className="space-y-2">
							<div className="flex items-center gap-2">
								<div className="w-2 h-2 rounded-full bg-green-500" />
								<span>Credits System</span>
							</div>
							<div className="flex items-center gap-2">
								<div className="w-2 h-2 rounded-full bg-green-500" />
								<span>Hybrid Mode</span>
							</div>
						</div>
					</div>
				</div>
			</CardContent>
			<CardFooter className="flex justify-between">
				{!isProPlan ? (
					<UpgradeToProDialog>
						<Button>Upgrade to Pro</Button>
					</UpgradeToProDialog>
				) : (
					<div className="flex gap-2">
						{/* Show upgrade to yearly button for monthly subscribers (not during trial) */}
						{!isTrialActive &&
							!subscriptionStatus?.subscriptionCancelled &&
							subscriptionStatus?.billingCycle === "monthly" && (
								<Button
									variant="default"
									onClick={handleUpgradeToYearly}
									disabled={upgradeToYearlyMutation.isPending}
								>
									{upgradeToYearlyMutation.isPending
										? "Upgrading..."
										: "Upgrade to Yearly (Save 20%)"}
								</Button>
							)}
						{!subscriptionStatus?.subscriptionCancelled && (
							<Button
								variant="outline"
								onClick={handleCancelSubscription}
								disabled={cancelSubscriptionMutation.isPending}
							>
								{cancelSubscriptionMutation.isPending
									? "Canceling..."
									: isTrialActive
										? "Cancel Trial"
										: "Cancel Subscription"}
							</Button>
						)}
						{subscriptionStatus?.subscriptionCancelled && (
							<div className="flex items-center gap-2">
								<Badge variant="destructive">Subscription Canceled</Badge>
								<Button
									variant="default"
									onClick={handleResumeSubscription}
									disabled={resumeSubscriptionMutation.isPending}
								>
									{resumeSubscriptionMutation.isPending
										? "Resuming..."
										: "Resume Subscription"}
								</Button>
							</div>
						)}
					</div>
				)}
			</CardFooter>
		</Card>
	);
}
