"use client";

import {
	ArrowRight,
	Code,
	Copy,
	Eye,
	EyeOff,
	Key,
	Loader2,
	LogOut,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
import type { DevPlanCycle } from "@llmgateway/shared";

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
const UsageOverview = dynamic(() => import("./components/UsageOverview"));
const CodingAgents = dynamic(() => import("./components/CodingAgents"));

const plans: PlanOption[] = [
	{
		name: "Lite",
		price: 29,
		usage: 87,
		description: "For occasional coding",
		tier: "lite",
	},
	{
		name: "Pro",
		price: 79,
		usage: 237,
		description: "For daily development",
		tier: "pro",
		popular: true,
	},
	{
		name: "Max",
		price: 179,
		usage: 537,
		description: "For power users",
		tier: "max",
	},
];

function ApiKeySection({ apiKey, uiUrl }: { apiKey: string; uiUrl: string }) {
	const [visible, setVisible] = useState(false);

	const copy = async () => {
		await navigator.clipboard.writeText(apiKey);
		toast.success("Copied to clipboard");
	};

	return (
		<div className="space-y-3">
			<div className="flex items-center gap-2">
				<Key className="h-4 w-4 text-muted-foreground" />
				<h3 className="text-sm font-medium">API Key</h3>
			</div>
			<div className="flex gap-2">
				<Input
					type={visible ? "text" : "password"}
					value={apiKey}
					readOnly
					className="font-mono text-sm h-9"
				/>
				<Button
					variant="outline"
					size="icon"
					className="h-9 w-9 shrink-0"
					onClick={() => setVisible(!visible)}
					title={visible ? "Hide" : "Reveal"}
				>
					{visible ? (
						<EyeOff className="h-3.5 w-3.5" />
					) : (
						<Eye className="h-3.5 w-3.5" />
					)}
				</Button>
				<Button
					variant="outline"
					size="icon"
					className="h-9 w-9 shrink-0"
					onClick={copy}
					title="Copy"
				>
					<Copy className="h-3.5 w-3.5" />
				</Button>
			</div>
			<div className="flex items-center gap-4 text-xs text-muted-foreground">
				<a
					href={`${uiUrl}/guides`}
					target="_blank"
					rel="noopener noreferrer"
					className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
				>
					Setup guides
					<ArrowRight className="h-3 w-3" />
				</a>
				<a
					href={`${uiUrl}/models?coding=true`}
					target="_blank"
					rel="noopener noreferrer"
					className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
				>
					All models
					<ArrowRight className="h-3 w-3" />
				</a>
			</div>
		</div>
	);
}

function QuickStart({ apiKey }: { apiKey: string }) {
	const maskedKey =
		apiKey.length > 16 ? `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}` : apiKey;

	const copySnippet = async () => {
		const snippet = `export ANTHROPIC_BASE_URL=https://api.llmgateway.io\nexport ANTHROPIC_AUTH_TOKEN=${apiKey}\nclaude`;
		await navigator.clipboard.writeText(snippet);
		toast.success("Snippet copied");
	};

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<h3 className="text-sm font-medium">Quick start</h3>
				<button
					type="button"
					onClick={copySnippet}
					className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
				>
					<Copy className="h-3 w-3" />
					Copy
				</button>
			</div>
			<div className="rounded-lg border bg-muted/30 p-4 font-mono text-xs leading-relaxed">
				<div>
					<span className="text-muted-foreground">$</span> export
					ANTHROPIC_BASE_URL=
					<span className="text-foreground">https://api.llmgateway.io</span>
				</div>
				<div className="mt-0.5">
					<span className="text-muted-foreground">$</span> export
					ANTHROPIC_AUTH_TOKEN=
					<span className="text-foreground">{maskedKey}</span>
				</div>
				<div className="mt-0.5">
					<span className="text-muted-foreground">$</span> claude
				</div>
			</div>
		</div>
	);
}

export default function DashboardClient() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const posthog = usePostHog();
	const { signOut } = useAuth();
	const config = useAppConfig();
	const { posthogKey } = config;
	const api = useApi();
	const [subscribingTier, setSubscribingTier] = useState<PlanTier | null>(null);
	const [isCancelling, setIsCancelling] = useState(false);
	const [isResuming, setIsResuming] = useState(false);

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
		tier: PlanTier,
		cycle: DevPlanCycle = "monthly",
	): Promise<void> => {
		setSubscribingTier(tier);
		try {
			const result = await subscribeMutation.mutateAsync({
				body: { tier, cycle },
			});

			if (!result?.checkoutUrl) {
				toast.error("Failed to start subscription");
				return;
			}

			if (posthogKey) {
				posthog.capture("dev_plan_subscribe_started", { tier, cycle });
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
		// Cycle is intentionally not sent — the server preserves the existing
		// monthly/annual cadence by reading it from the org's stored devPlanCycle
		// and looks up the matching annual or monthly Stripe price ID.
		setSubscribingTier(newTier);
		try {
			await changeTierMutation.mutateAsync({
				body: { newTier },
			});
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

	const handleSignOut = async () => {
		await signOut();
		router.push("/");
	};

	if (userLoading || statusLoading) {
		return (
			<div className="min-h-screen flex items-center justify-center">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		);
	}

	const hasActivePlan =
		devPlanStatus?.devPlan && devPlanStatus.devPlan !== "none";
	const creditsUsed = parseFloat(devPlanStatus?.devPlanCreditsUsed ?? "0");
	const creditsLimit = parseFloat(devPlanStatus?.devPlanCreditsLimit ?? "0");

	const currentPlanName = devPlanStatus?.devPlan?.toUpperCase() ?? "";
	const currentPlanData = plans.find((p) => p.tier === devPlanStatus?.devPlan);

	return (
		<div className="min-h-screen bg-background">
			{/* Header */}
			<header className="border-b border-border/50">
				<div className="container mx-auto flex items-center justify-between px-4 py-3">
					<div className="flex items-center gap-6">
						<Link href="/" className="flex items-center gap-2">
							<Code className="h-5 w-5" />
							<span className="font-semibold">DevPass</span>
						</Link>
						{hasActivePlan && (
							<span className="hidden sm:inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium">
								{currentPlanName}
							</span>
						)}
					</div>
					<div className="flex items-center gap-3">
						<span className="hidden sm:block text-sm text-muted-foreground">
							{user?.email}
						</span>
						<Button
							variant="ghost"
							size="sm"
							onClick={handleSignOut}
							className="gap-1.5 text-muted-foreground"
						>
							<LogOut className="h-3.5 w-3.5" />
							<span className="hidden sm:inline">Sign out</span>
						</Button>
					</div>
				</div>
			</header>

			<main className="container mx-auto px-4 py-8 max-w-6xl">
				{hasActivePlan ? (
					<div className="space-y-10">
						{/* Top row: subscription controls (cancel/resume) */}
						<div className="flex justify-end">
							{devPlanStatus?.devPlanCancelled ? (
								<Button
									variant="outline"
									size="sm"
									onClick={handleResume}
									disabled={isResuming}
								>
									{isResuming && (
										<Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
									)}
									Resume subscription
								</Button>
							) : (
								<Button
									variant="ghost"
									size="sm"
									onClick={handleCancel}
									disabled={isCancelling}
									className="text-muted-foreground"
								>
									{isCancelling && (
										<Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
									)}
									Cancel subscription
								</Button>
							)}
						</div>

						{/* Usage — full-width with metrics + chart */}
						<UsageOverview
							projectId={devPlanStatus?.projectId ?? null}
							creditsUsed={creditsUsed}
							creditsLimit={creditsLimit}
							planName={currentPlanName}
							planPrice={currentPlanData?.price}
							billingCycleStart={
								devPlanStatus?.devPlanBillingCycleStart ?? null
							}
							cancelledAtPeriodEnd={devPlanStatus?.devPlanCancelled ?? false}
							cycle={devPlanStatus?.devPlanCycle ?? "monthly"}
						/>

						{/* API Key + Quick start */}
						<div className="grid gap-6 lg:grid-cols-2">
							<div className="rounded-xl border bg-card p-6">
								{devPlanStatus?.apiKey ? (
									<ApiKeySection
										apiKey={devPlanStatus.apiKey}
										uiUrl={config.uiUrl}
									/>
								) : (
									<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
										API key will appear here after setup
									</div>
								)}
							</div>
							<div className="rounded-xl border bg-card p-6">
								{devPlanStatus?.apiKey ? (
									<QuickStart apiKey={devPlanStatus.apiKey} />
								) : null}
							</div>
						</div>

						{/* Coding Agents */}
						{devPlanStatus?.organizationId && (
							<CodingAgents orgId={devPlanStatus.organizationId} />
						)}

						{/* Integrations */}
						<DashboardIntegrations />

						{/* Models */}
						<div>
							<h2 className="mb-4 font-semibold">Coding models</h2>
							<CodingModelsShowcase uiUrl={config.uiUrl} />
						</div>

						{/* Settings */}
						<DevPlanSettings
							devPlanAllowAllModels={
								devPlanStatus?.devPlanAllowAllModels ?? false
							}
						/>

						{/* Change plan */}
						<ActivePlanChangeTier
							plans={plans}
							currentPlan={devPlanStatus?.devPlan ?? null}
							subscribingTier={subscribingTier}
							onChangeTier={handleChangeTier}
						/>
					</div>
				) : (
					<div className="space-y-10">
						<div className="mx-auto max-w-md text-center pt-4">
							<div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
								<Code className="h-6 w-6 text-muted-foreground" />
							</div>
							<h1 className="text-xl font-semibold mb-2">
								Choose your Dev Plan
							</h1>
							<p className="text-sm text-muted-foreground leading-relaxed">
								Pick a plan to get your API key and start coding with 200+
								models. Every dollar gives you 3x in usage.
							</p>
						</div>

						<InactivePlanChooser
							plans={plans}
							subscribingTier={subscribingTier}
							onSubscribe={handleSubscribe}
							initialCycle={
								searchParams.get("cycle") === "annual" ? "annual" : "monthly"
							}
						/>
					</div>
				)}
			</main>
		</div>
	);
}
