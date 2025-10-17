"use client";

import { Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";

import { UpgradeToProDialog } from "@/components/shared/upgrade-to-pro-dialog";
import { useUser } from "@/hooks/useUser";
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
import { Label } from "@/lib/components/label";
import { Switch } from "@/lib/components/switch";
import { useToast } from "@/lib/components/use-toast";

interface SubscriptionStatus {
	plan: "free" | "pro";
	subscriptionId: string | null;
	planExpiresAt: string | null;
	subscriptionCancelled: boolean;
}

export function PricingPlans() {
	const { user } = useUser();
	const { toast } = useToast();
	const router = useRouter();
	const [billingCycle, setBillingCycle] = useState<"monthly" | "annual">(
		"monthly",
	);
	const [loading, setLoading] = useState<string | null>(null);
	const [subscriptionStatus, setSubscriptionStatus] =
		useState<SubscriptionStatus | null>(null);

	// Fetch subscription status for authenticated users
	useEffect(() => {
		if (user) {
			fetchSubscriptionStatus();
		}
	}, [user]);

	const fetchSubscriptionStatus = async () => {
		try {
			const response = await fetch("/api/subscriptions/status", {
				credentials: "include",
			});
			if (response.ok) {
				const status = await response.json();
				setSubscriptionStatus(status);
			}
		} catch (error) {
			console.error("Failed to fetch subscription status:", error);
		}
	};

	const handleCreateProSubscription = async () => {
		if (!user) {
			router.push("/signup?nextUrl=/pricing?plan=pro");
			return;
		}

		setLoading("pro");

		try {
			const response = await fetch(
				"/api/subscriptions/create-pro-subscription",
				{
					method: "POST",
					credentials: "include",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						billingCycle: billingCycle === "annual" ? "yearly" : "monthly",
					}),
				},
			);

			if (!response.ok) {
				const error = await response.text();
				throw new Error(error);
			}

			const { checkoutUrl } = await response.json();

			// Redirect to Stripe Checkout
			window.location.href = checkoutUrl;
		} catch (error: any) {
			const errorMessage =
				error?.error?.message ||
				error?.message ||
				(error instanceof Error
					? error.message
					: "Failed to create checkout session. Please try again.");
			toast({
				title: "Subscription failed",
				description: errorMessage,
				variant: "destructive",
			});
			setLoading(null);
		}
	};

	const handleCancelSubscription = async () => {
		if (!subscriptionStatus?.subscriptionId) {
			return;
		}

		setLoading("cancel");
		try {
			const response = await fetch(
				"/api/subscriptions/cancel-pro-subscription",
				{
					method: "POST",
					credentials: "include",
				},
			);

			if (!response.ok) {
				const error = await response.text();
				throw new Error(error);
			}

			toast({
				title: "Subscription cancelled",
				description:
					"Your subscription will remain active until the end of the billing period.",
			});
			await fetchSubscriptionStatus();
		} catch (error: any) {
			const errorMessage =
				error?.error?.message ||
				error?.message ||
				(error instanceof Error
					? error.message
					: "Failed to cancel subscription. Please try again.");
			toast({
				title: "Cancellation failed",
				description: errorMessage,
				variant: "destructive",
			});
		} finally {
			setLoading(null);
		}
	};

	const handleResumeSubscription = async () => {
		if (!subscriptionStatus?.subscriptionId) {
			return;
		}

		setLoading("resume");
		try {
			const response = await fetch(
				"/api/subscriptions/resume-pro-subscription",
				{
					method: "POST",
					credentials: "include",
				},
			);

			if (!response.ok) {
				const error = await response.text();
				throw new Error(error);
			}

			toast({
				title: "Subscription resumed",
				description: "Your Pro subscription has been reactivated.",
			});
			await fetchSubscriptionStatus();
		} catch (error: any) {
			const errorMessage =
				error?.error?.message ||
				error?.message ||
				(error instanceof Error
					? error.message
					: "Failed to resume subscription. Please try again.");
			toast({
				title: "Resume failed",
				description: errorMessage,
				variant: "destructive",
			});
		} finally {
			setLoading(null);
		}
	};

	const handlePlanSelection = (planName: string) => {
		switch (planName) {
			case "Self-Host":
				router.push("https://docs.llmgateway.io");
				return;
			case "Enterprise":
				router.push("mailto:contact@llmgateway.io");
				return;
			case "Pro":
				handleCreateProSubscription();
				return;
		}

		if (!user) {
			router.push("/signup");
		} else {
			router.push("/dashboard");
		}
	};

	const plans = [
		{
			name: "Self-Host",
			description: "Host on your own infrastructure",
			price: {
				monthly: "Free",
				annual: "Free",
			},
			features: [
				"100% free forever",
				"Full control over your data",
				"Host on your infrastructure",
				"No usage limits",
				"Community support",
				"Regular updates",
			],
			cta: "View Documentation",
			popular: false,
			disabled: false,
		},
		{
			name: "Free",
			description: "Perfect for trying out the platform",
			price: {
				monthly: "$0",
				annual: "$0",
			},
			features: [
				"Access to ALL models",
				"Pay with credits",
				"5% LLMGateway fee on credit usage",
				"3-day data retention",
				"Standard support",
			],
			cta: user ? "Current Plan" : "Get Started",
			popular: false,
			disabled: subscriptionStatus?.plan === "free",
		},
		{
			name: "Pro",
			description: "For professionals and growing teams",
			price: {
				monthly: "$50",
				annual: "$500",
			},
			features: [
				"Use your own API keys without surcharges",
				"NO fees on credit purchases",
				"100,000 included requests/month",
				"$0.0001 per additional request",
				"90-day data retention",
				"Advanced Analytics",
				"Team Members (+$20/user/month)",
				"Priority support",
			],
			cta:
				subscriptionStatus?.plan === "pro"
					? subscriptionStatus.subscriptionCancelled
						? "Resume"
						: "Cancel"
					: "Upgrade to Pro",
			popular: true,
			disabled: false,
		},
		{
			name: "Enterprise",
			description: "For large organizations with custom needs",
			price: {
				monthly: "Custom",
				annual: "Custom",
			},
			features: [
				"Everything in Pro",
				"Unlimited seats",
				"Prioritized feature requests",
				"On-boarding assistance",
				"Unlimited data retention",
				"24/7 premium support",
				"Chat-App (incl. whitelabel)",
				"Single Sign-On (SSO)",
			],
			cta: "Contact Sales",
			popular: false,
			disabled: false,
		},
	];

	const discount = 20;

	return (
		<section className="w-full py-12 md:py-24 bg-muted/30" id="pricing">
			<div className="container mx-auto px-4 md:px-6">
				<div className="text-center mb-12">
					<Badge variant="outline" className="mb-4">
						Pricing
					</Badge>
					<h2 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl mb-4">
						Start for free, Scale with no fees
					</h2>
					<p className="text-xl text-muted-foreground max-w-3xl mx-auto">
						Choose the plan that works best for your needs, with no hidden fees
						or surprises. Start with a free 7-day trial on Pro plans.
					</p>

					<div className="flex items-center justify-center mt-8 space-x-4">
						<Label
							htmlFor="billing-toggle"
							className={
								billingCycle === "monthly"
									? "font-medium"
									: "text-muted-foreground"
							}
						>
							Monthly
						</Label>
						<Switch
							id="billing-toggle"
							checked={billingCycle === "annual"}
							onCheckedChange={(checked: boolean) =>
								setBillingCycle(checked ? "annual" : "monthly")
							}
						/>
						<div className="flex items-center">
							<Label
								htmlFor="billing-toggle"
								className={
									billingCycle === "annual"
										? "font-medium"
										: "text-muted-foreground"
								}
							>
								Annual
							</Label>
							<Badge variant="secondary" className="ml-2">
								Save {discount}%
							</Badge>
						</div>
					</div>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
					{plans.map((plan, index) => {
						const isCurrentPlan =
							subscriptionStatus?.plan === plan.name.toLowerCase();
						const isLoading =
							loading === plan.name.toLowerCase() ||
							(plan.name === "Pro" &&
								(loading === "cancel" || loading === "resume"));

						return (
							<Card
								key={index}
								className={`flex flex-col relative ${
									plan.popular ? "border-primary shadow-lg relative" : ""
								} ${isCurrentPlan ? "ring-2 ring-primary" : ""}`}
							>
								{plan.popular && (
									<div className="absolute top-0 right-0 transform translate-x-2 -translate-y-2">
										<Badge className="bg-primary hover:bg-primary">
											Free 7-day trial
										</Badge>
									</div>
								)}
								{isCurrentPlan && (
									<div className="absolute top-0 left-0 transform -translate-x-2 -translate-y-2">
										<Badge variant="secondary">Current Plan</Badge>
									</div>
								)}
								<CardHeader>
									<CardTitle>{plan.name}</CardTitle>
									<CardDescription>{plan.description}</CardDescription>
									<div className="mt-4">
										<span className="text-3xl font-bold">
											{plan.price[billingCycle]}
										</span>
										{plan.price[billingCycle] !== "Custom" &&
											plan.price[billingCycle] !== "Free" &&
											plan.price[billingCycle] !== "$0" && (
												<span className="text-muted-foreground ml-1">
													/{billingCycle === "monthly" ? "month" : "year"}
												</span>
											)}
									</div>
									{subscriptionStatus?.subscriptionCancelled &&
										plan.name === "Pro" && (
											<Badge variant="outline" className="mt-2">
												Cancelled - Active until{" "}
												{subscriptionStatus.planExpiresAt
													? new Date(
															subscriptionStatus.planExpiresAt,
														).toLocaleDateString()
													: "end of billing period"}
											</Badge>
										)}
								</CardHeader>
								<CardContent className="flex-grow">
									<ul className="space-y-2">
										{plan.features.map((feature, i) => (
											<li key={i} className="flex items-center">
												<Check className="h-4 w-4 mr-2 text-green-500" />
												<span className="text-sm">{feature}</span>
											</li>
										))}
									</ul>
								</CardContent>
								<CardFooter>
									{plan.name === "Pro" &&
									subscriptionStatus?.plan !== "pro" &&
									user ? (
										<UpgradeToProDialog
											initialBillingCycle={
												billingCycle === "annual" ? "yearly" : "monthly"
											}
										>
											<Button
												className={`w-full ${plan.popular ? "bg-primary hover:bg-primary/90" : ""}`}
												variant={plan.popular ? "default" : "outline"}
												disabled={plan.disabled || isLoading}
											>
												{isLoading && (
													<Loader2 className="mr-2 h-4 w-4 animate-spin" />
												)}
												{plan.cta}
											</Button>
										</UpgradeToProDialog>
									) : (
										<Button
											className={`w-full ${plan.popular ? "bg-primary hover:bg-primary/90" : ""}`}
											variant={plan.popular ? "default" : "outline"}
											disabled={plan.disabled || isLoading}
											onClick={() => {
												if (
													plan.name === "Pro" &&
													subscriptionStatus?.plan === "pro"
												) {
													if (subscriptionStatus.subscriptionCancelled) {
														handleResumeSubscription();
													} else {
														handleCancelSubscription();
													}
												} else {
													handlePlanSelection(plan.name);
												}
											}}
										>
											{isLoading && (
												<Loader2 className="mr-2 h-4 w-4 animate-spin" />
											)}
											{plan.cta}
										</Button>
									)}
								</CardFooter>
							</Card>
						);
					})}
				</div>

				<div className="mt-12 text-center">
					<p className="text-muted-foreground">
						All plans include access to our API, documentation, and community
						support.
						<br />
						Need a custom solution?{" "}
						<a
							href="mailto:contact@llmgateway.io"
							className="text-primary hover:underline"
						>
							Contact our sales team
						</a>
						.
					</p>
				</div>
			</div>
		</section>
	);
}
