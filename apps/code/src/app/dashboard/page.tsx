"use client";

import { format } from "date-fns";
import {
	Code,
	CreditCard,
	Loader2,
	LogOut,
	Check,
	ArrowRight,
	Copy,
	ExternalLink,
	Key,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUser } from "@/hooks/useUser";
import { useAuth } from "@/lib/auth-client";
import { useAppConfig } from "@/lib/config";
import { useApi } from "@/lib/fetch-client";

import {
	AnthropicIcon,
	ClineIcon,
	OpenCodeIcon,
} from "@llmgateway/shared/components";

const integrations = [
	{
		name: "Claude Code",
		description: "AI-powered terminal assistance and coding",
		href: "/guides/claude-code",
		icon: AnthropicIcon,
		external: false,
	},
	{
		name: "OpenCode",
		description: "AI-powered development workflows",
		href: "/guides/opencode",
		icon: OpenCodeIcon,
		external: false,
	},
	{
		name: "Cline",
		description: "AI-powered coding in VS Code",
		href: "https://docs.llmgateway.io/guides/cline",
		icon: ClineIcon,
		external: true,
	},
];

const plans = [
	{
		name: "Lite",
		price: 29,
		description: "For small dev tasks",
		tier: "lite" as const,
	},
	{
		name: "Pro",
		price: 79,
		description: "For advanced usage",
		tier: "pro" as const,
		popular: true,
	},
	{
		name: "Max",
		price: 179,
		description: "For ultra high usage",
		tier: "max" as const,
	},
];

export default function Dashboard() {
	const router = useRouter();
	const posthog = usePostHog();
	const { signOut } = useAuth();
	const config = useAppConfig();
	const api = useApi();
	const [subscribingTier, setSubscribingTier] = useState<string | null>(null);
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

	const handleSubscribe = async (
		tier: "lite" | "pro" | "max",
	): Promise<void> => {
		setSubscribingTier(tier);
		try {
			const result = await subscribeMutation.mutateAsync({
				body: { tier },
			});

			if (!result?.checkoutUrl) {
				toast.error("Failed to start subscription");
				return;
			}

			posthog.capture("dev_plan_subscribe_started", { tier });
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
			posthog.capture("dev_plan_cancelled");
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
			posthog.capture("dev_plan_resumed");
			toast.success("Subscription resumed");
		} catch {
			toast.error("Failed to resume subscription");
		} finally {
			setIsResuming(false);
		}
	};

	const handleChangeTier = async (
		newTier: "lite" | "pro" | "max",
	): Promise<void> => {
		setSubscribingTier(newTier);
		try {
			await changeTierMutation.mutateAsync({
				body: { newTier },
			});
			posthog.capture("dev_plan_tier_changed", { newTier });
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
											href={`${config.uiUrl}/models`}
											target="_blank"
											rel="noopener noreferrer"
											className="underline hover:text-foreground"
										>
											View all models
										</a>
									</div>
								</div>
							</div>
						)}

						<div className="rounded-lg border p-6">
							<div className="flex items-center gap-2 mb-4">
								<Code className="h-5 w-5" />
								<h3 className="font-semibold">Common Use Cases</h3>
							</div>
							<p className="text-sm text-muted-foreground mb-4">
								Popular integrations for AI-powered coding.
							</p>
							<div className="grid gap-3 sm:grid-cols-3">
								{integrations.map((integration) => (
									<a
										key={integration.name}
										href={
											integration.external
												? integration.href
												: `${config.uiUrl}${integration.href}`
										}
										target="_blank"
										rel="noopener noreferrer"
										className="group flex items-start gap-3 rounded-lg border p-4 transition-all hover:border-primary/50 hover:shadow-sm"
									>
										<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
											<integration.icon className="h-5 w-5" />
										</div>
										<div className="flex-1 min-w-0">
											<div className="flex items-center gap-1">
												<span className="font-medium text-sm">
													{integration.name}
												</span>
												<ArrowRight className="h-3 w-3 text-muted-foreground opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0" />
											</div>
											<p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
												{integration.description}
											</p>
										</div>
									</a>
								))}
							</div>
						</div>

						<div>
							<h3 className="font-semibold mb-4">Change Plan</h3>
							<div className="grid md:grid-cols-3 gap-4">
								{plans.map((plan) => {
									const isCurrentPlan = devPlanStatus?.devPlan === plan.tier;
									return (
										<div
											key={plan.tier}
											className={`rounded-lg border p-4 ${isCurrentPlan ? "border-primary ring-2 ring-primary/20" : ""}`}
										>
											<div className="flex items-center justify-between mb-2">
												<span className="font-medium">{plan.name}</span>
												{isCurrentPlan && (
													<span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded">
														Current
													</span>
												)}
											</div>
											<p className="text-2xl font-bold mb-4">
												${plan.price}/mo
											</p>
											{!isCurrentPlan && (
												<Button
													className="w-full"
													variant="outline"
													size="sm"
													onClick={() => handleChangeTier(plan.tier)}
													disabled={subscribingTier === plan.tier}
												>
													{subscribingTier === plan.tier ? (
														<Loader2 className="h-4 w-4 animate-spin" />
													) : (
														<>
															Switch <ArrowRight className="h-4 w-4 ml-1" />
														</>
													)}
												</Button>
											)}
										</div>
									);
								})}
							</div>
						</div>
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

						<div>
							<h3 className="font-semibold mb-4">Choose a Plan</h3>
							<div className="grid md:grid-cols-3 gap-6">
								{plans.map((plan) => (
									<div
										key={plan.tier}
										className={`rounded-lg border p-6 ${plan.popular ? "border-primary ring-2 ring-primary/20 relative" : ""}`}
									>
										{plan.popular && (
											<div className="absolute -top-3 left-1/2 -translate-x-1/2">
												<span className="bg-primary text-primary-foreground text-xs font-medium px-3 py-1 rounded-full">
													Most Popular
												</span>
											</div>
										)}
										<div className="text-center mb-4">
											<h4 className="font-semibold">{plan.name}</h4>
											<p className="text-sm text-muted-foreground">
												{plan.description}
											</p>
										</div>
										<div className="text-center mb-4">
											<span className="text-3xl font-bold">${plan.price}</span>
											<span className="text-muted-foreground">/month</span>
										</div>
										<ul className="space-y-2 mb-6">
											<li className="flex items-center gap-2 text-sm">
												<Check className="h-4 w-4 text-primary" />
												Access to all models
											</li>
											<li className="flex items-center gap-2 text-sm">
												<Check className="h-4 w-4 text-primary" />
												Usage resets monthly
											</li>
										</ul>
										<Button
											className="w-full"
											variant={plan.popular ? "default" : "outline"}
											onClick={() => handleSubscribe(plan.tier)}
											disabled={subscribingTier === plan.tier}
										>
											{subscribingTier === plan.tier ? (
												<Loader2 className="h-4 w-4 animate-spin" />
											) : (
												"Subscribe"
											)}
										</Button>
									</div>
								))}
							</div>
						</div>
					</div>
				)}
			</main>
		</div>
	);
}
