"use client";

import { useQueryClient } from "@tanstack/react-query";

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
import { useDashboardState } from "@/lib/dashboard-state";
import { useApi } from "@/lib/fetch-client";

export function PlanManagement() {
	const { selectedOrganization } = useDashboardState();
	const { toast } = useToast();
	const queryClient = useQueryClient();
	const api = useApi();

	const { data: subscriptionStatus } = api.useQuery(
		"get",
		"/subscriptions/status",
	);

	// Keep cancel/resume mutations for existing Pro subscribers (backward compatibility)
	const cancelSubscriptionMutation = api.useMutation(
		"post",
		"/subscriptions/cancel-pro-subscription",
	);

	const resumeSubscriptionMutation = api.useMutation(
		"post",
		"/subscriptions/resume-pro-subscription",
	);

	const handleCancelSubscription = async () => {
		const confirmed = window.confirm(
			"Are you sure you want to cancel your legacy Pro subscription? All features are now available on the Free plan.",
		);

		if (!confirmed) {
			return;
		}

		await cancelSubscriptionMutation.mutateAsync({});
		await queryClient.invalidateQueries({
			queryKey: api.queryOptions("get", "/subscriptions/status").queryKey,
		});
		toast({
			title: "Subscription Canceled",
			description:
				"Your Pro subscription has been canceled. All features remain available on the Free plan.",
		});
	};

	const handleResumeSubscription = async () => {
		const confirmed = window.confirm(
			"Are you sure you want to resume your legacy Pro subscription?",
		);

		if (!confirmed) {
			return;
		}

		await resumeSubscriptionMutation.mutateAsync({});
		await queryClient.invalidateQueries({
			queryKey: api.queryOptions("get", "/subscriptions/status").queryKey,
		});
		toast({
			title: "Subscription Resumed",
			description: "Your Pro subscription has been resumed.",
		});
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

	// Legacy Pro subscribers may still exist
	const isLegacyPro = selectedOrganization.plan === "pro";
	const planExpiresAt = selectedOrganization.planExpiresAt
		? new Date(selectedOrganization.planExpiresAt)
		: null;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Plan & Billing</CardTitle>
				<CardDescription>Manage your billing preferences</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				<div className="flex items-center justify-between">
					<div>
						<div className="flex items-center gap-2">
							<h3 className="text-lg font-medium">Current Plan</h3>
							<Badge variant="default">
								{isLegacyPro ? "Pro (Legacy)" : "Free"}
							</Badge>
						</div>
						<p className="text-sm text-muted-foreground mt-1">
							All features included
						</p>
						{isLegacyPro && planExpiresAt && (
							<p className="text-sm text-muted-foreground mt-1">
								{subscriptionStatus?.subscriptionCancelled
									? `Expires on ${planExpiresAt.toDateString()}`
									: `Renews on ${planExpiresAt.toDateString()}`}
							</p>
						)}
					</div>
					<div className="text-right">
						<p className="text-2xl font-bold">
							{isLegacyPro
								? subscriptionStatus?.billingCycle === "yearly"
									? "$500"
									: "$50"
								: "$0"}
							<span className="text-sm font-normal text-muted-foreground">
								{isLegacyPro
									? subscriptionStatus?.billingCycle === "yearly"
										? "/year"
										: "/month"
									: "/forever"}
							</span>
						</p>
					</div>
				</div>

				<div className="border rounded-lg p-4 space-y-3">
					<h4 className="font-medium">Included Features</h4>
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
						<div className="space-y-2">
							<div className="flex items-center gap-2">
								<div className="w-2 h-2 rounded-full bg-green-500" />
								<span>Provider API Keys (BYOK)</span>
							</div>
							<div className="flex items-center gap-2">
								<div className="w-2 h-2 rounded-full bg-green-500" />
								<span>30-day data retention</span>
							</div>
							<div className="flex items-center gap-2">
								<div className="w-2 h-2 rounded-full bg-green-500" />
								<span>Team Management</span>
							</div>
						</div>
						<div className="space-y-2">
							<div className="flex items-center gap-2">
								<div className="w-2 h-2 rounded-full bg-green-500" />
								<span>Advanced Analytics</span>
							</div>
							<div className="flex items-center gap-2">
								<div className="w-2 h-2 rounded-full bg-green-500" />
								<span>Auto-routing</span>
							</div>
							<div className="flex items-center gap-2">
								<div className="w-2 h-2 rounded-full bg-green-500" />
								<span>Credits & Hybrid Mode</span>
							</div>
						</div>
					</div>
				</div>
			</CardContent>
			{/* Only show subscription management for legacy Pro subscribers */}
			{isLegacyPro && (
				<CardFooter className="flex justify-between">
					<div className="flex gap-2">
						{!subscriptionStatus?.subscriptionCancelled && (
							<Button
								variant="outline"
								onClick={handleCancelSubscription}
								disabled={cancelSubscriptionMutation.isPending}
							>
								{cancelSubscriptionMutation.isPending
									? "Canceling..."
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
				</CardFooter>
			)}
		</Card>
	);
}
