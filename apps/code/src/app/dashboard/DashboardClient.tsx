"use client";

import { format } from "date-fns";
import {
	Code,
	CreditCard,
	Loader2,
	LogOut,
	Copy,
	ExternalLink,
	Key,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useState } from "react";
import { toast } from "sonner";

import { CodingModelsShowcase } from "@/components/CodingModelsShowcase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUser } from "@/hooks/useUser";
import { useAuth } from "@/lib/auth-client";
import { useAppConfig } from "@/lib/config";
import { useApi } from "@/lib/fetch-client";

import type { PlanOption, PlanTier } from "./types";

const DashboardIntegrations = dynamic(
	() => import("./components/DashboardIntegrations"),
);
const ActivePlanChangeTier = dynamic(
	() => import("./components/ActivePlanChangeTier"),
);
const InactivePlanChooser = dynamic(
	() => import("./components/InactivePlanChooser"),
);
const DevPlanSettings = dynamic(() => import("./components/DevPlanSettings"));

const plans: PlanOption[] = [
	{
		name: "Lite",
		price: 29,
		description: "For small dev tasks",
		tier: "lite",
	},
	{
		name: "Pro",
		price: 79,
		description: "For advanced usage",
		tier: "pro",
		popular: true,
	},
	{
		name: "Max",
		price: 179,
		description: "For ultra high usage",
		tier: "max",
	},
];

export default function DashboardClient() {
	const router = useRouter();
	const posthog = usePostHog();
	const { signOut } = useAuth();
	const config = useAppConfig();
	const { posthogKey } = config;
	const api = useApi();
	const [subscribingTier, setSubscribingTier] = useState<PlanTier | null>(null);
	const [isCancelling, setIsCancelling] = useState(false);
	const [isResuming, setIsResuming] = useState(false);
	const [showApiKey, setShowApiKey] = useState(false);

	const { user, isLoading: userLoading } = useUser({
		redirectTo: "/login?returnUrl=/dashboard",
		redirectWhen: "unauthenticated",
	});

	const { data: devPlanStatus, isLoading: statusLoading } = api.useQuery(
		"get",
		"/dev-plans/status",
		{},
		{
			enabled: !!user,
			refetchInterval: 5000,
		},
	);

	const subscribeMutation = api.useMutation("post", "/dev-plans/subscribe");
	const cancelMutation = api.useMutation("post", "/dev-plans/cancel");
	const resumeMutation = api.useMutation("post", "/dev-plans/resume");
	const changeTierMutation = api.useMutation("post", "/dev-plans/change-tier");

	const handleSubscribe = async (tier: PlanTier): Promise<void> => {
		setSubscribingTier(tier);
		try {
			const result = await subscribeMutation.mutateAsync({
				body: { tier },
			});

			if (!result?.checkoutUrl) {
				toast.error("Failed to start subscription");
				return;
			}

			if (posthogKey) {
				posthog.capture("dev_plan_subscribe_started", { tier });
			}
			window.location.href = result.checkoutUrl;
		} catch {
			toast.error("Failed to start subscription");
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

	const handleChangeTier = async (newTier: PlanTier): Promise<void> => {
		setSubscribingTier(newTier);
		try {
			await changeTierMutation.mutateAsync({
				body: { newTier },
			});
			if (posthogKey) {
				posthog.capture("dev_plan_tier_changed", { newTier });
			}
			toast.success("Plan changed successfully", {
				description: "Your plan has been updated.",
			});
		} catch {
			toast.error("Failed to change plan");
		} finally {
			setSubscribingTier(null);
		}
	};

	const handleSignOut = async () => {
		await signOut();
		router.push("/");
	};

	const handleCopyApiKey = async () => {
		if (devPlanStatus?.apiKey) {
			await navigator.clipboard.writeText(devPlanStatus.apiKey);
			toast.success("API key copied to clipboard");
		}
	};

	if (userLoading || statusLoading) {
		return (
			<div className="min-h-screen flex items-center justify-center">
				<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
			</div>
		);
	}

	const hasActivePlan =
		devPlanStatus?.devPlan && devPlanStatus.devPlan !== "none";
	const creditsUsed = parseFloat(devPlanStatus?.devPlanCreditsUsed || "0");
	const creditsLimit = parseFloat(devPlanStatus?.devPlanCreditsLimit || "0");
	const usagePercentage =
		creditsLimit > 0 ? (creditsUsed / creditsLimit) * 100 : 0;

	return (
		<div className="min-h-screen bg-background">
			<header className="border-b">
				<div className="container mx-auto px-4 py-4 flex items-center justify-between">
					<Link href="/" className="flex items-center gap-2">
						<Code className="h-6 w-6" />
						<span className="font-semibold text-lg">LLM Gateway Code</span>
					</Link>
					<div className="flex items-center gap-4">
						<span className="text-sm text-muted-foreground">{user?.email}</span>
						<Button variant="ghost" size="sm" onClick={handleSignOut}>
							<LogOut className="h-4 w-4 mr-2" />
							Sign out
						</Button>
					</div>
				</div>
			</header>

			<main className="container mx-auto px-4 py-8 max-w-4xl">
				<h1 className="text-2xl font-bold mb-8">Dashboard</h1>

				{hasActivePlan ? (
					<div className="space-y-8">
						<div className="rounded-lg border p-6">
							<div className="flex items-center justify-between mb-4">
								<div>
									<h2 className="font-semibold text-lg">
										{devPlanStatus?.devPlan?.toUpperCase()} Plan
									</h2>
									<p className="text-sm text-muted-foreground">
										{devPlanStatus?.devPlanCancelled
											? "Cancels at end of billing period"
											: "Active subscription"}
									</p>
								</div>
								<div className="flex items-center gap-2">
									{devPlanStatus?.devPlanCancelled ? (
										<Button
											variant="outline"
											onClick={handleResume}
											disabled={isResuming}
										>
											{isResuming ? (
												<Loader2 className="h-4 w-4 animate-spin mr-2" />
											) : null}
											Resume Plan
										</Button>
									) : (
										<Button
											variant="outline"
											onClick={handleCancel}
											disabled={isCancelling}
										>
											{isCancelling ? (
												<Loader2 className="h-4 w-4 animate-spin mr-2" />
											) : null}
											Cancel Plan
										</Button>
									)}
								</div>
							</div>

							<div className="space-y-4">
								<div>
									<div className="flex justify-between text-sm mb-2">
										<span>Usage</span>
										<span>{usagePercentage.toFixed(0)}%</span>
									</div>
									<div className="h-2 bg-muted rounded-full overflow-hidden">
										<div
											className="h-full bg-primary transition-all"
											style={{ width: `${Math.min(100, usagePercentage)}%` }}
										/>
									</div>
									<p className="text-sm text-muted-foreground mt-2">
										{Math.max(0, 100 - usagePercentage).toFixed(0)}% remaining
										this cycle
									</p>
								</div>

								{devPlanStatus?.devPlanBillingCycleStart && (
									<p className="text-sm text-muted-foreground">
										Billing cycle started:{" "}
										{format(
											new Date(devPlanStatus.devPlanBillingCycleStart),
											"MMM d, yyyy",
										)}
									</p>
								)}
							</div>
						</div>

						{devPlanStatus?.apiKey && (
							<div className="rounded-lg border p-6">
								<div className="flex items-center gap-2 mb-4">
									<Key className="h-5 w-5" />
									<h3 className="font-semibold">Your API Key</h3>
								</div>
								<p className="text-sm text-muted-foreground mb-4">
									Use this API key to authenticate with LLM Gateway in your
									coding tools.
								</p>
								<div className="flex gap-2 mb-4">
									<Input
										type={showApiKey ? "text" : "password"}
										value={devPlanStatus.apiKey}
										readOnly
										className="font-mono text-sm"
									/>
									<Button
										variant="outline"
										size="icon"
										onClick={handleCopyApiKey}
									>
										<Copy className="h-4 w-4" />
									</Button>
									<Button
										variant="outline"
										onClick={() => setShowApiKey(!showApiKey)}
									>
										{showApiKey ? "Hide" : "Show"}
									</Button>
								</div>
								<div className="flex gap-4">
									<div className="flex items-center gap-2 text-sm text-muted-foreground">
										<ExternalLink className="h-4 w-4" />
										<a
											href={`${config.uiUrl}/guides`}
											target="_blank"
											rel="noopener noreferrer"
											className="underline hover:text-foreground"
										>
											View integration guides
										</a>
									</div>
									<div className="flex items-center gap-2 text-sm text-muted-foreground">
										<ExternalLink className="h-4 w-4" />
										<a
											href={`${config.uiUrl}/models?coding=true`}
											target="_blank"
											rel="noopener noreferrer"
											className="underline hover:text-foreground"
										>
											View all coding models
										</a>
									</div>
								</div>
							</div>
						)}

						<CodingModelsShowcase uiUrl={config.uiUrl} />

						<DevPlanSettings
							devPlanAllowAllModels={
								devPlanStatus?.devPlanAllowAllModels ?? false
							}
						/>

						<DashboardIntegrations />

						<ActivePlanChangeTier
							plans={plans}
							currentPlan={devPlanStatus?.devPlan ?? null}
							subscribingTier={subscribingTier}
							onChangeTier={handleChangeTier}
						/>
					</div>
				) : (
					<div className="space-y-8">
						<div className="rounded-lg border p-6 text-center">
							<CreditCard className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
							<h2 className="font-semibold text-lg mb-2">No Active Plan</h2>
							<p className="text-muted-foreground mb-4">
								Subscribe to a Dev Plan for AI-powered coding.
							</p>
						</div>

						<InactivePlanChooser
							plans={plans}
							subscribingTier={subscribingTier}
							onSubscribe={handleSubscribe}
						/>
					</div>
				)}
			</main>
		</div>
	);
}
