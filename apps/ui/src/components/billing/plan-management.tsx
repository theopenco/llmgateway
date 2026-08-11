"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePostHog } from "posthog-js/react";
import { useEffect, useState } from "react";

import { EnterprisePlanTerm } from "@/components/billing/enterprise-plan-term";
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
import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import { Separator } from "@/lib/components/separator";
import { Switch } from "@/lib/components/switch";
import { useToast } from "@/lib/components/use-toast";
import { useDashboardState } from "@/lib/dashboard-state";
import { useApi } from "@/lib/fetch-client";

import {
	getOrganizationTerm,
	getProPlanMonthlyTotal,
	PRO_PLAN_MAX_EXTRA_API_KEYS,
	PRO_PLAN_MAX_SEATS,
	PRO_PLAN_MIN_SEATS,
	PRO_PLAN_PRICES,
} from "@llmgateway/shared";

const ENTERPRISE_FEATURES = [
	"Dedicated support & SLA",
	"Provider compliance policies",
	"SSO & audit logs",
	"Extended data retention",
	"Custom models & guardrails",
	"Volume pricing",
];

interface ProSelection {
	seats: number;
	extraApiKeys: number;
	ssoAddon: boolean;
	scimAddon: boolean;
}

function clampInt(value: number, min: number, max: number): number {
	if (Number.isNaN(value)) {
		return min;
	}
	return Math.min(max, Math.max(min, Math.trunc(value)));
}

// The fetch client rejects with the parsed API error body ({ message }), not
// an Error instance, so read the message off whatever shape arrives.
function errorMessage(error: unknown): string {
	if (
		error &&
		typeof error === "object" &&
		"message" in error &&
		typeof (error as { message?: unknown }).message === "string"
	) {
		return (error as { message: string }).message;
	}
	return "Please try again.";
}

// Seat/extra-key/SSO selector with a live monthly price breakdown. Each seat
// includes one API key — only keys beyond the seat count are billed extra.
function ProPlanConfigurator({
	selection,
	onChange,
	seatsUsed,
}: {
	selection: ProSelection;
	onChange: (selection: ProSelection) => void;
	seatsUsed: number | null;
}) {
	const total = getProPlanMonthlyTotal(selection);

	return (
		<div className="space-y-4">
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<div className="space-y-2">
					<Label htmlFor="pro-seats">Seats</Label>
					<Input
						id="pro-seats"
						type="number"
						min={PRO_PLAN_MIN_SEATS}
						max={PRO_PLAN_MAX_SEATS}
						value={selection.seats}
						onChange={(e) =>
							onChange({
								...selection,
								seats: clampInt(
									e.target.valueAsNumber,
									PRO_PLAN_MIN_SEATS,
									PRO_PLAN_MAX_SEATS,
								),
							})
						}
					/>
					<p className="text-xs text-muted-foreground">
						${PRO_PLAN_PRICES.seat}/user/month, minimum {PRO_PLAN_MIN_SEATS}{" "}
						seats, up to {PRO_PLAN_MAX_SEATS} users. Each seat includes one API
						key.
						{seatsUsed !== null && ` Currently using ${seatsUsed} seats.`}
					</p>
				</div>
				<div className="space-y-2">
					<Label htmlFor="pro-extra-keys">Extra API keys</Label>
					<Input
						id="pro-extra-keys"
						type="number"
						min={0}
						max={PRO_PLAN_MAX_EXTRA_API_KEYS}
						value={selection.extraApiKeys}
						onChange={(e) =>
							onChange({
								...selection,
								extraApiKeys: clampInt(
									e.target.valueAsNumber,
									0,
									PRO_PLAN_MAX_EXTRA_API_KEYS,
								),
							})
						}
					/>
					<p className="text-xs text-muted-foreground">
						${PRO_PLAN_PRICES.extraApiKey}/month each. Only keys beyond your{" "}
						{selection.seats} included one{selection.seats === 1 ? "" : "s"} are
						billed.
					</p>
				</div>
			</div>

			<div className="flex items-center justify-between rounded-lg border p-4">
				<div className="space-y-0.5">
					<Label htmlFor="pro-sso">SSO add-on</Label>
					<p className="text-xs text-muted-foreground">
						SAML single sign-on for your organization. ${PRO_PLAN_PRICES.sso}
						/month.
					</p>
				</div>
				<Switch
					id="pro-sso"
					checked={selection.ssoAddon}
					onCheckedChange={(checked) =>
						onChange({
							...selection,
							ssoAddon: checked,
							// SCIM rides on the SSO connection, so dropping SSO drops SCIM.
							scimAddon: checked ? selection.scimAddon : false,
						})
					}
				/>
			</div>

			<div className="flex items-center justify-between rounded-lg border p-4">
				<div className="space-y-0.5">
					<Label htmlFor="pro-scim">SCIM add-on</Label>
					<p className="text-xs text-muted-foreground">
						SCIM user provisioning from your identity provider. $
						{PRO_PLAN_PRICES.scim}/month. Requires the SSO add-on.
					</p>
				</div>
				<Switch
					id="pro-scim"
					checked={selection.scimAddon}
					disabled={!selection.ssoAddon}
					onCheckedChange={(checked) =>
						onChange({ ...selection, scimAddon: checked })
					}
				/>
			</div>

			<div className="space-y-2 rounded-lg border p-4 text-sm">
				<div className="flex justify-between">
					<span>
						{selection.seats} seat{selection.seats === 1 ? "" : "s"} × $
						{PRO_PLAN_PRICES.seat} (includes {selection.seats} API key
						{selection.seats === 1 ? "" : "s"})
					</span>
					<span>${selection.seats * PRO_PLAN_PRICES.seat}</span>
				</div>
				{selection.extraApiKeys > 0 && (
					<div className="flex justify-between">
						<span>
							{selection.extraApiKeys} extra API key
							{selection.extraApiKeys === 1 ? "" : "s"} × $
							{PRO_PLAN_PRICES.extraApiKey}
						</span>
						<span>${selection.extraApiKeys * PRO_PLAN_PRICES.extraApiKey}</span>
					</div>
				)}
				{selection.ssoAddon && (
					<div className="flex justify-between">
						<span>SSO add-on</span>
						<span>${PRO_PLAN_PRICES.sso}</span>
					</div>
				)}
				{selection.scimAddon && (
					<div className="flex justify-between">
						<span>SCIM add-on</span>
						<span>${PRO_PLAN_PRICES.scim}</span>
					</div>
				)}
				<Separator />
				<div className="flex justify-between font-medium">
					<span>Total</span>
					<span>${total}/month</span>
				</div>
			</div>

			<p className="text-xs text-muted-foreground">
				Need more than {PRO_PLAN_MAX_SEATS} seats or volume discounts?{" "}
				<Link href="/enterprise" className="underline underline-offset-2">
					Contact us
				</Link>{" "}
				about Enterprise.
			</p>
		</div>
	);
}

export function PlanManagement() {
	const { selectedOrganization } = useDashboardState();
	const { toast } = useToast();
	const queryClient = useQueryClient();
	const api = useApi();
	const posthog = usePostHog();

	const organizationId = selectedOrganization?.id;

	const { data: subscriptionStatus } = api.useQuery(
		"get",
		"/subscriptions/status",
		{
			params: { query: { organizationId: organizationId ?? "" } },
		},
		{ enabled: !!organizationId },
	);

	const { data: teamData } = api.useQuery(
		"get",
		"/team/{organizationId}/members",
		{
			params: { path: { organizationId: organizationId ?? "" } },
		},
		{ enabled: !!organizationId },
	);

	// Seat-based Pro state: proSeats is only set for the new per-seat
	// subscriptions; legacy flat-fee Pro subscribers keep the old management UI.
	const isPro = selectedOrganization?.plan === "pro";
	const isSeatBasedPro = isPro && selectedOrganization?.proSeats !== null;
	const isLegacyPro = isPro && selectedOrganization?.proSeats === null;

	const seatsUsed = teamData
		? teamData.members.length + teamData.invites.length
		: null;

	const currentSelection: ProSelection = {
		seats:
			selectedOrganization?.proSeats ??
			Math.max(seatsUsed ?? PRO_PLAN_MIN_SEATS, PRO_PLAN_MIN_SEATS),
		extraApiKeys: selectedOrganization?.proExtraApiKeys ?? 0,
		ssoAddon: selectedOrganization?.proSsoEnabled ?? false,
		scimAddon: selectedOrganization?.proScimEnabled ?? false,
	};

	const [selection, setSelection] = useState<ProSelection>(currentSelection);

	// Re-seed the form when the org (or its subscription) changes, e.g. after a
	// checkout redirect or org switch.
	useEffect(() => {
		setSelection({
			seats:
				selectedOrganization?.proSeats ??
				Math.max(
					teamData ? teamData.members.length : PRO_PLAN_MIN_SEATS,
					PRO_PLAN_MIN_SEATS,
				),
			extraApiKeys: selectedOrganization?.proExtraApiKeys ?? 0,
			ssoAddon: selectedOrganization?.proSsoEnabled ?? false,
			scimAddon: selectedOrganization?.proScimEnabled ?? false,
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		selectedOrganization?.id,
		selectedOrganization?.proSeats,
		selectedOrganization?.proExtraApiKeys,
		selectedOrganization?.proSsoEnabled,
		selectedOrganization?.proScimEnabled,
	]);

	const createSubscriptionMutation = api.useMutation(
		"post",
		"/subscriptions/create-pro-subscription",
	);
	const updateSubscriptionMutation = api.useMutation(
		"post",
		"/subscriptions/update-pro-subscription",
	);
	const cancelSubscriptionMutation = api.useMutation(
		"post",
		"/subscriptions/cancel-pro-subscription",
	);
	const resumeSubscriptionMutation = api.useMutation(
		"post",
		"/subscriptions/resume-pro-subscription",
	);

	const invalidatePlanQueries = async () => {
		await Promise.all([
			queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/subscriptions/status", {
					params: { query: { organizationId: organizationId ?? "" } },
				}).queryKey,
			}),
			queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/orgs").queryKey,
			}),
		]);
	};

	const handleUpgrade = async () => {
		if (!organizationId) {
			return;
		}
		posthog.capture("pro_upgrade_checkout_started", {
			seats: selection.seats,
			extraApiKeys: selection.extraApiKeys,
			ssoAddon: selection.ssoAddon,
		});
		try {
			const result = await createSubscriptionMutation.mutateAsync({
				body: { ...selection, organizationId },
			});
			window.location.href = result.checkoutUrl;
		} catch (error) {
			toast({
				title: "Could not start checkout",
				description: errorMessage(error),
				variant: "destructive",
			});
		}
	};

	const handleUpdateSubscription = async () => {
		if (!organizationId) {
			return;
		}
		posthog.capture("pro_subscription_update_initiated", {
			seats: selection.seats,
			extraApiKeys: selection.extraApiKeys,
			ssoAddon: selection.ssoAddon,
		});
		try {
			await updateSubscriptionMutation.mutateAsync({
				body: { ...selection, organizationId },
			});
			await invalidatePlanQueries();
			toast({
				title: "Subscription updated",
				description: `Your Pro subscription is now ${selection.seats} seat${selection.seats === 1 ? "" : "s"} for $${getProPlanMonthlyTotal(selection)}/month. Changes are prorated on your next invoice.`,
			});
		} catch (error) {
			toast({
				title: "Could not update subscription",
				description: errorMessage(error),
				variant: "destructive",
			});
		}
	};

	const handleCancelSubscription = async () => {
		const confirmed = window.confirm(
			"Are you sure you want to cancel your Pro subscription? Your seats, extra API keys, and add-ons remain active until the end of the billing period.",
		);

		if (!confirmed) {
			return;
		}

		posthog.capture("subscription_cancel_initiated");

		await cancelSubscriptionMutation.mutateAsync({
			body: { organizationId },
		});
		await invalidatePlanQueries();
		toast({
			title: "Subscription Canceled",
			description:
				"Your Pro subscription has been canceled and will end at the current billing period.",
		});
	};

	const handleResumeSubscription = async () => {
		const confirmed = window.confirm(
			"Are you sure you want to resume your Pro subscription?",
		);

		if (!confirmed) {
			return;
		}

		posthog.capture("subscription_resume_initiated");

		await resumeSubscriptionMutation.mutateAsync({
			body: { organizationId },
		});
		await invalidatePlanQueries();
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

	const planExpiresAt = selectedOrganization.planExpiresAt
		? new Date(selectedOrganization.planExpiresAt)
		: null;

	if (selectedOrganization.plan === "enterprise") {
		const resolved = getOrganizationTerm({
			isTrialActive: selectedOrganization.isTrialActive,
			trialStartDate: selectedOrganization.trialStartDate,
			trialEndDate: selectedOrganization.trialEndDate,
			planStartedAt: selectedOrganization.planStartedAt,
			planExpiresAt: selectedOrganization.planExpiresAt,
		});
		const trial = resolved?.kind === "trial";

		// Rendered without its own Card: the billing page already wraps this in
		// one, and a second border around the term meter buries the countdown.
		return (
			<div className="space-y-6">
				<div className="flex items-center gap-2">
					<h3 className="text-lg font-medium">
						{trial ? "Enterprise trial" : "Enterprise agreement"}
					</h3>
					<Badge variant={trial ? "secondary" : "default"}>
						{trial ? "Trial" : "Enterprise"}
					</Badge>
				</div>

				<EnterprisePlanTerm
					term={resolved?.term ?? null}
					kind={resolved?.kind ?? "contract"}
				/>

				<div className="space-y-3 rounded-lg border p-4">
					<h4 className="font-medium">
						{trial ? "Included during your trial" : "Included with Enterprise"}
					</h4>
					<div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
						<div className="space-y-2">
							{ENTERPRISE_FEATURES.slice(0, 3).map((feature) => (
								<div key={feature} className="flex items-center gap-2">
									<div className="h-2 w-2 rounded-full bg-green-500" />
									<span>{feature}</span>
								</div>
							))}
						</div>
						<div className="space-y-2">
							{ENTERPRISE_FEATURES.slice(3).map((feature) => (
								<div key={feature} className="flex items-center gap-2">
									<div className="h-2 w-2 rounded-full bg-green-500" />
									<span>{feature}</span>
								</div>
							))}
						</div>
					</div>
				</div>
			</div>
		);
	}

	// Legacy flat-fee Pro subscribers: keep the historical management card.
	if (isLegacyPro) {
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
								<Badge variant="default">Pro (Legacy)</Badge>
							</div>
							{planExpiresAt && (
								<p className="text-sm text-muted-foreground mt-1">
									{subscriptionStatus?.subscriptionCancelled
										? `Expires on ${planExpiresAt.toDateString()}`
										: `Renews on ${planExpiresAt.toDateString()}`}
								</p>
							)}
						</div>
						<div className="text-right">
							<p className="text-2xl font-bold">
								{subscriptionStatus?.billingCycle === "yearly" ? "$500" : "$50"}
								<span className="text-sm font-normal text-muted-foreground">
									{subscriptionStatus?.billingCycle === "yearly"
										? "/year"
										: "/month"}
								</span>
							</p>
						</div>
					</div>
				</CardContent>
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
			</Card>
		);
	}

	if (isSeatBasedPro) {
		const hasChanges =
			selection.seats !== currentSelection.seats ||
			selection.extraApiKeys !== currentSelection.extraApiKeys ||
			selection.ssoAddon !== currentSelection.ssoAddon ||
			selection.scimAddon !== currentSelection.scimAddon;

		return (
			<Card>
				<CardHeader>
					<CardTitle>Plan & Billing</CardTitle>
					<CardDescription>Manage your Pro subscription</CardDescription>
				</CardHeader>
				<CardContent className="space-y-6">
					<div className="flex items-center justify-between">
						<div>
							<div className="flex items-center gap-2">
								<h3 className="text-lg font-medium">Current Plan</h3>
								<Badge variant="default">Pro</Badge>
							</div>
							<p className="text-sm text-muted-foreground mt-1">
								{currentSelection.seats} seat
								{currentSelection.seats === 1 ? "" : "s"},{" "}
								{currentSelection.seats + currentSelection.extraApiKeys} API key
								{currentSelection.seats + currentSelection.extraApiKeys === 1
									? ""
									: "s"}
								{currentSelection.ssoAddon
									? currentSelection.scimAddon
										? ", SSO & SCIM"
										: ", SSO"
									: ""}
							</p>
							{planExpiresAt && (
								<p className="text-sm text-muted-foreground mt-1">
									{subscriptionStatus?.subscriptionCancelled
										? `Expires on ${planExpiresAt.toDateString()}`
										: `Renews on ${planExpiresAt.toDateString()}`}
								</p>
							)}
						</div>
						<div className="text-right">
							<p className="text-2xl font-bold">
								${getProPlanMonthlyTotal(currentSelection)}
								<span className="text-sm font-normal text-muted-foreground">
									/month
								</span>
							</p>
						</div>
					</div>

					<Separator />

					<ProPlanConfigurator
						selection={selection}
						onChange={setSelection}
						seatsUsed={seatsUsed}
					/>
				</CardContent>
				<CardFooter className="flex flex-wrap items-center justify-between gap-2">
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
					<Button
						onClick={handleUpdateSubscription}
						disabled={!hasChanges || updateSubscriptionMutation.isPending}
					>
						{updateSubscriptionMutation.isPending
							? "Updating..."
							: "Update Subscription"}
					</Button>
				</CardFooter>
			</Card>
		);
	}

	// Free plan: current state plus the self-serve Pro upgrade form. Personal
	// (devpass/chat) orgs can't subscribe, but they never reach this page.
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
							<Badge variant="default">Free</Badge>
						</div>
						<p className="text-sm text-muted-foreground mt-1">
							All features included
						</p>
					</div>
					<div className="text-right">
						<p className="text-2xl font-bold">
							$0
							<span className="text-sm font-normal text-muted-foreground">
								/forever
							</span>
						</p>
					</div>
				</div>

				<Separator />

				<div className="space-y-4">
					<div>
						<div className="flex items-center gap-2">
							<h3 className="text-lg font-medium">Upgrade to Pro</h3>
							<Badge variant="secondary">
								${PRO_PLAN_PRICES.seat}/user/month
							</Badge>
						</div>
						<p className="text-sm text-muted-foreground mt-1">
							Same features as Free — scale past the free limits with up to{" "}
							{PRO_PLAN_MAX_SEATS} seats, one API key included per seat, and
							optional add-ons.
						</p>
					</div>

					<ProPlanConfigurator
						selection={selection}
						onChange={setSelection}
						seatsUsed={seatsUsed}
					/>
				</div>
			</CardContent>
			<CardFooter className="flex justify-end">
				<Button
					onClick={handleUpgrade}
					disabled={createSubscriptionMutation.isPending}
				>
					{createSubscriptionMutation.isPending
						? "Redirecting..."
						: "Upgrade to Pro"}
				</Button>
			</CardFooter>
		</Card>
	);
}
