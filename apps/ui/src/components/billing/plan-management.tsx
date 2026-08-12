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
import { Progress } from "@/lib/components/progress";
import { Separator } from "@/lib/components/separator";
import { Switch } from "@/lib/components/switch";
import { useToast } from "@/lib/components/use-toast";
import { useDashboardState } from "@/lib/dashboard-state";
import { useApi } from "@/lib/fetch-client";

import {
	getOrganizationTerm,
	getProPlanMonthlyTotal,
	PRO_PLAN_INCLUDED_PROJECTS,
	PRO_PLAN_MAX_EXTRA_API_KEYS,
	PRO_PLAN_MAX_EXTRA_PROJECTS,
	PRO_PLAN_MAX_SEATS,
	PRO_PLAN_MIN_SEATS,
	PRO_PLAN_PRICES,
	PRO_PLAN_SSO_MAX_SEATS,
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
	extraProjects: number;
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

// Current usage vs the plan's limits, so the plan page always answers "how
// much of what I pay for am I using?" at a glance. Limits come server-side
// (admin override → purchased Pro quantities → plan defaults).
function PlanUsageOverview({
	seatsUsed,
	seatLimit,
	keysUsed,
	keyLimit,
	projectsUsed,
	projectLimit,
}: {
	seatsUsed: number | null;
	seatLimit: number | null;
	keysUsed: number | null;
	keyLimit: number | null;
	projectsUsed: number | null;
	projectLimit: number | null;
}) {
	const bars = [
		{
			label: "Seats",
			used: seatsUsed,
			limit: seatLimit,
			hint: "Members plus pending invites",
		},
		{
			label: "API keys",
			used: keysUsed,
			limit: keyLimit,
			hint: "Active API keys across your organization",
		},
		{
			label: "Projects",
			used: projectsUsed,
			limit: projectLimit,
			hint: "Projects in your organization",
		},
	].filter((bar) => bar.used !== null && bar.limit !== null && bar.limit > 0);

	if (!bars.length) {
		return null;
	}

	return (
		<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
			{bars.map((bar) => {
				const used = bar.used ?? 0;
				const limit = bar.limit ?? 1;
				const atLimit = used >= limit;
				return (
					<div key={bar.label} className="space-y-2 rounded-lg border p-4">
						<div className="flex items-baseline justify-between">
							<span className="text-sm font-medium">{bar.label}</span>
							<span
								className={`text-sm font-medium ${atLimit ? "text-destructive" : "text-muted-foreground"}`}
							>
								{used} of {limit} used
							</span>
						</div>
						<Progress value={Math.min(100, (used / limit) * 100)} />
						<p className="text-xs text-muted-foreground">{bar.hint}</p>
					</div>
				);
			})}
		</div>
	);
}

// Seat/extra-key/SSO selector with a live monthly price breakdown. Each seat
// includes one API key — only keys beyond the seat count are billed extra.
function ProPlanConfigurator({
	selection,
	onChange,
	seatsUsed,
	keysUsed,
}: {
	selection: ProSelection;
	onChange: (selection: ProSelection) => void;
	seatsUsed: number | null;
	keysUsed: number | null;
}) {
	const total = getProPlanMonthlyTotal(selection);
	const totalKeys = selection.seats + selection.extraApiKeys;
	// SSO (and SCIM on top of it) is only available up to the seat cap;
	// larger teams need Enterprise.
	const ssoAvailable = selection.seats <= PRO_PLAN_SSO_MAX_SEATS;

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
						onChange={(e) => {
							const seats = clampInt(
								e.target.valueAsNumber,
								PRO_PLAN_MIN_SEATS,
								PRO_PLAN_MAX_SEATS,
							);
							onChange({
								...selection,
								seats,
								// SSO/SCIM are capped; raising seats past the cap drops them.
								ssoAddon: seats <= PRO_PLAN_SSO_MAX_SEATS && selection.ssoAddon,
								scimAddon:
									seats <= PRO_PLAN_SSO_MAX_SEATS && selection.scimAddon,
							});
						}}
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
						{selection.seats} included key{selection.seats === 1 ? "" : "s"} are
						billed.
					</p>
				</div>
				<div className="space-y-2">
					<Label htmlFor="pro-extra-projects">Extra projects</Label>
					<Input
						id="pro-extra-projects"
						type="number"
						min={0}
						max={PRO_PLAN_MAX_EXTRA_PROJECTS}
						value={selection.extraProjects}
						onChange={(e) =>
							onChange({
								...selection,
								extraProjects: clampInt(
									e.target.valueAsNumber,
									0,
									PRO_PLAN_MAX_EXTRA_PROJECTS,
								),
							})
						}
					/>
					<p className="text-xs text-muted-foreground">
						${PRO_PLAN_PRICES.extraProject}/month each, beyond the{" "}
						{PRO_PLAN_INCLUDED_PROJECTS} included projects.
					</p>
				</div>
			</div>

			<div className="flex items-center justify-between rounded-lg border p-4">
				<div className="space-y-0.5">
					<Label htmlFor="pro-sso">SSO add-on</Label>
					<p className="text-xs text-muted-foreground">
						SAML single sign-on for your organization. ${PRO_PLAN_PRICES.sso}
						/month. Available up to {PRO_PLAN_SSO_MAX_SEATS} seats
						{!ssoAvailable && (
							<>
								{" "}
								— for larger teams,{" "}
								<a
									href="mailto:contact@llmgateway.io"
									className="underline underline-offset-2"
								>
									contact us
								</a>{" "}
								about Enterprise
							</>
						)}
						.
					</p>
				</div>
				<Switch
					id="pro-sso"
					disabled={!ssoAvailable}
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
					disabled={!selection.ssoAddon || !ssoAvailable}
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
				{selection.extraProjects > 0 && (
					<div className="flex justify-between">
						<span>
							{selection.extraProjects} extra project
							{selection.extraProjects === 1 ? "" : "s"} × $
							{PRO_PLAN_PRICES.extraProject}
						</span>
						<span>
							${selection.extraProjects * PRO_PLAN_PRICES.extraProject}
						</span>
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

			<div className="rounded-lg border bg-muted/50 p-4 text-sm">
				<span className="font-medium">
					With this plan you get {selection.seats} seat
					{selection.seats === 1 ? "" : "s"}, {totalKeys} API key
					{totalKeys === 1 ? "" : "s"}, and{" "}
					{PRO_PLAN_INCLUDED_PROJECTS + selection.extraProjects} projects in
					total.
				</span>{" "}
				<span className="text-muted-foreground">
					Currently using {seatsUsed ?? 0} seat
					{(seatsUsed ?? 0) === 1 ? "" : "s"}
					{keysUsed !== null
						? ` and ${keysUsed} API key${keysUsed === 1 ? "" : "s"}`
						: ""}
					.
				</span>
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
	const { selectedOrganization, selectedProject, projects } =
		useDashboardState();
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

	// planLimits counts active developer keys across the WHOLE org and returns
	// the org-wide cap; the projectId only scopes the key listing itself.
	const { data: keysData } = api.useQuery(
		"get",
		"/keys/api",
		{
			params: { query: { projectId: selectedProject?.id ?? "" } },
		},
		{ enabled: !!selectedProject?.id },
	);

	// Seat-based Pro state: proSeats is only set for the new per-seat
	// subscriptions; legacy flat-fee Pro subscribers keep the old management UI.
	const isPro = selectedOrganization?.plan === "pro";
	const isSeatBasedPro = isPro && selectedOrganization?.proSeats !== null;
	const isLegacyPro = isPro && selectedOrganization?.proSeats === null;

	const seatsUsed = teamData
		? teamData.members.length + teamData.invites.length
		: null;
	const seatLimit = teamData?.seatLimit ?? null;
	const keysUsed = keysData?.planLimits?.currentCount ?? null;
	const keyLimit = keysData?.planLimits?.maxKeys ?? null;
	// Project usage: the org's project list is already loaded for the sidebar;
	// the limit mirrors the API's rule (enterprise 250, seat-based Pro buys
	// extras on top of the included allowance).
	const projectsUsed = projects.length > 0 ? projects.length : null;
	const projectLimit =
		selectedOrganization?.plan === "enterprise"
			? 250
			: selectedOrganization?.plan === "pro" &&
				  selectedOrganization?.proSeats !== null
				? PRO_PLAN_INCLUDED_PROJECTS +
					(selectedOrganization?.proExtraProjects ?? 0)
				: PRO_PLAN_INCLUDED_PROJECTS;

	const currentSelection: ProSelection = {
		seats:
			selectedOrganization?.proSeats ??
			Math.max(seatsUsed ?? PRO_PLAN_MIN_SEATS, PRO_PLAN_MIN_SEATS),
		extraApiKeys: selectedOrganization?.proExtraApiKeys ?? 0,
		extraProjects: selectedOrganization?.proExtraProjects ?? 0,
		ssoAddon: selectedOrganization?.proSsoEnabled ?? false,
		scimAddon: selectedOrganization?.proScimEnabled ?? false,
	};

	const [selection, setSelection] = useState<ProSelection>(currentSelection);
	// Once the user touches the form, stop re-seeding it — otherwise the team
	// query resolving (or a background org refetch) would clobber their edits.
	const [selectionDirty, setSelectionDirty] = useState(false);

	const handleSelectionChange = (next: ProSelection) => {
		setSelectionDirty(true);
		setSelection(next);
	};

	// Seed (and re-seed) the untouched form when the org, its subscription, or
	// the team data changes — the team query resolves after first render, and
	// for a free org the seat default must cover current members + invites or
	// the server rejects the checkout.
	useEffect(() => {
		if (selectionDirty) {
			return;
		}
		setSelection({
			seats:
				selectedOrganization?.proSeats ??
				Math.max(seatsUsed ?? PRO_PLAN_MIN_SEATS, PRO_PLAN_MIN_SEATS),
			extraApiKeys: selectedOrganization?.proExtraApiKeys ?? 0,
			extraProjects: selectedOrganization?.proExtraProjects ?? 0,
			ssoAddon: selectedOrganization?.proSsoEnabled ?? false,
			scimAddon: selectedOrganization?.proScimEnabled ?? false,
		});
	}, [
		selectionDirty,
		seatsUsed,
		selectedOrganization?.id,
		selectedOrganization?.proSeats,
		selectedOrganization?.proExtraApiKeys,
		selectedOrganization?.proExtraProjects,
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
			// The form now matches the subscription again — let future org/team
			// refreshes re-seed it.
			setSelectionDirty(false);
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

		if (!organizationId) {
			return;
		}

		posthog.capture("subscription_cancel_initiated");

		try {
			await cancelSubscriptionMutation.mutateAsync({
				body: { organizationId },
			});
			await invalidatePlanQueries();
			toast({
				title: "Subscription Canceled",
				description:
					"Your Pro subscription has been canceled and will end at the current billing period.",
			});
		} catch (error) {
			toast({
				title: "Could not cancel subscription",
				description: errorMessage(error),
				variant: "destructive",
			});
		}
	};

	const handleResumeSubscription = async () => {
		const confirmed = window.confirm(
			"Are you sure you want to resume your Pro subscription?",
		);

		if (!confirmed) {
			return;
		}

		if (!organizationId) {
			return;
		}

		posthog.capture("subscription_resume_initiated");

		try {
			await resumeSubscriptionMutation.mutateAsync({
				body: { organizationId },
			});
			await invalidatePlanQueries();
			toast({
				title: "Subscription Resumed",
				description: "Your Pro subscription has been resumed.",
			});
		} catch (error) {
			toast({
				title: "Could not resume subscription",
				description: errorMessage(error),
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

					<PlanUsageOverview
						seatsUsed={seatsUsed}
						seatLimit={seatLimit}
						keysUsed={keysUsed}
						keyLimit={keyLimit}
						projectsUsed={projectsUsed}
						projectLimit={projectLimit}
					/>
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
			selection.extraProjects !== currentSelection.extraProjects ||
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

					<PlanUsageOverview
						seatsUsed={seatsUsed}
						seatLimit={seatLimit}
						keysUsed={keysUsed}
						keyLimit={keyLimit}
						projectsUsed={projectsUsed}
						projectLimit={projectLimit}
					/>

					<Separator />

					<ProPlanConfigurator
						selection={selection}
						onChange={handleSelectionChange}
						seatsUsed={seatsUsed}
						keysUsed={keysUsed}
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

				<PlanUsageOverview
					seatsUsed={seatsUsed}
					seatLimit={seatLimit}
					keysUsed={keysUsed}
					keyLimit={keyLimit}
					projectsUsed={projectsUsed}
					projectLimit={projectLimit}
				/>

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
						onChange={handleSelectionChange}
						seatsUsed={seatsUsed}
						keysUsed={keysUsed}
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
