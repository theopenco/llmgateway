"use client";

import { useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { usePostHog } from "posthog-js/react";
import { toast } from "sonner";

import ApiKeySection from "@/app/dashboard/components/ApiKeySection";
import { plans } from "@/app/dashboard/plans";
import { useDevPlanStatus } from "@/app/dashboard/useDevPlanStatus";
import { useAppConfig } from "@/lib/config";
import { useApi } from "@/lib/fetch-client";

const ActivityHeatmap = dynamic(
	() => import("@/app/dashboard/components/ActivityHeatmap"),
);
const DashboardIntegrations = dynamic(
	() => import("@/app/dashboard/components/DashboardIntegrations"),
);
const UsageOverview = dynamic(
	() => import("@/app/dashboard/components/UsageOverview"),
);
const CodingAgents = dynamic(
	() => import("@/app/dashboard/components/CodingAgents"),
);
const QuickStart = dynamic(
	() => import("@/app/dashboard/components/QuickStart"),
);

export default function UsagePage() {
	const config = useAppConfig();
	const { posthogKey } = config;
	const posthog = usePostHog();
	const api = useApi();
	const queryClient = useQueryClient();

	const { data: devPlanStatus } = useDevPlanStatus();

	const rotateApiKeyMutation = api.useMutation(
		"post",
		"/dev-plans/rotate-api-key",
	);

	const handleRotateApiKey = async (): Promise<void> => {
		try {
			await rotateApiKeyMutation.mutateAsync({});
			await queryClient.invalidateQueries({
				predicate: (query) => {
					const key = query.queryKey;
					return Array.isArray(key) && key[1] === "/dev-plans/status";
				},
			});
			if (posthogKey) {
				posthog.capture("dev_plan_api_key_rotated");
			}
			toast.success("API key rotated", {
				description:
					"Update your tools with the new key. The previous key no longer works.",
			});
		} catch {
			toast.error("Failed to rotate API key");
		}
	};

	if (!devPlanStatus) {
		return null;
	}

	const creditsUsed = parseFloat(devPlanStatus.devPlanCreditsUsed ?? "0");
	const creditsLimit = parseFloat(devPlanStatus.devPlanCreditsLimit ?? "0");
	const currentPlanName = devPlanStatus.devPlan?.toUpperCase() ?? "";
	const currentPlanData = plans.find((p) => p.tier === devPlanStatus.devPlan);

	return (
		<div className="space-y-10">
			{/* GitHub-style activity heatmap — first thing the user sees */}
			<ActivityHeatmap projectId={devPlanStatus.projectId ?? null} />

			{/* Usage — full-width with metrics + chart */}
			<UsageOverview
				projectId={devPlanStatus.projectId ?? null}
				organizationId={devPlanStatus.organizationId ?? null}
				creditsUsed={creditsUsed}
				creditsLimit={creditsLimit}
				premiumCreditsUsed={parseFloat(
					devPlanStatus.devPlanPremiumCreditsUsed ?? "0",
				)}
				premiumWeeklyLimit={parseFloat(
					devPlanStatus.devPlanPremiumWeeklyLimit ?? "0",
				)}
				premiumWeekResetsAt={devPlanStatus.devPlanPremiumWeekResetsAt ?? null}
				resetPasses={devPlanStatus.devPlanResetPasses ?? 0}
				includedResetPasses={devPlanStatus.devPlanIncludedResetPasses ?? 0}
				includedResetPassesRemaining={
					devPlanStatus.devPlanIncludedResetPassesRemaining ?? 0
				}
				resetPassPrice={devPlanStatus.devPlanResetPassPrice ?? null}
				planName={currentPlanName}
				planPrice={currentPlanData?.price}
				billingCycleStart={devPlanStatus.devPlanBillingCycleStart ?? null}
				currentPeriodEnd={devPlanStatus.devPlanExpiresAt ?? null}
				cancelledAtPeriodEnd={devPlanStatus.devPlanCancelled ?? false}
				cycle={devPlanStatus.devPlanCycle ?? "monthly"}
			/>

			{/* API Key + Quick start */}
			<div className="grid gap-6 lg:grid-cols-2">
				<div className="rounded-xl border bg-card p-6">
					{devPlanStatus.apiKey ? (
						<ApiKeySection
							apiKey={devPlanStatus.apiKey}
							uiUrl={config.uiUrl}
							onRotate={handleRotateApiKey}
							isRotating={rotateApiKeyMutation.isPending}
						/>
					) : (
						<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
							API key will appear here after setup
						</div>
					)}
				</div>
				<div className="rounded-xl border bg-card p-6">
					{devPlanStatus.apiKey ? (
						<QuickStart apiKey={devPlanStatus.apiKey} />
					) : null}
				</div>
			</div>

			{/* Coding Agents */}
			{devPlanStatus.organizationId && (
				<CodingAgents
					orgId={devPlanStatus.organizationId}
					projectId={devPlanStatus.projectId ?? null}
				/>
			)}

			{/* Integrations */}
			<DashboardIntegrations uiUrl={config.uiUrl} />
		</div>
	);
}
