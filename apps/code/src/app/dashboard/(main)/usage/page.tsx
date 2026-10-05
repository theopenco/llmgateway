"use client";

import UsageOverview from "@/app/dashboard/components/UsageOverview";
import { plans } from "@/app/dashboard/plans";
import { useDevPlanStatus } from "@/app/dashboard/useDevPlanStatus";

export default function UsagePage() {
	const { data: devPlanStatus } = useDevPlanStatus();

	if (!devPlanStatus) {
		return null;
	}

	const creditsUsed = parseFloat(devPlanStatus.devPlanCreditsUsed ?? "0");
	const creditsLimit = parseFloat(devPlanStatus.devPlanCreditsLimit ?? "0");
	const premiumCreditsUsed = parseFloat(
		devPlanStatus.devPlanPremiumCreditsUsed ?? "0",
	);
	const premiumWeeklyLimit = parseFloat(
		devPlanStatus.devPlanPremiumWeeklyLimit ?? "0",
	);
	const currentPlanName = devPlanStatus.devPlan?.toUpperCase() ?? "";
	const currentPlanData = plans.find((p) => p.tier === devPlanStatus.devPlan);

	return (
		<div className="space-y-10">
			<UsageOverview
				projectId={devPlanStatus.projectId ?? null}
				organizationId={devPlanStatus.organizationId ?? null}
				creditsUsed={creditsUsed}
				creditsLimit={creditsLimit}
				premiumCreditsUsed={premiumCreditsUsed}
				premiumWeeklyLimit={premiumWeeklyLimit}
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
				subscriptionPaymentStatus={
					devPlanStatus.subscriptionPaymentStatus ?? "current"
				}
				cycle={devPlanStatus.devPlanCycle ?? "monthly"}
				paygEnabled={devPlanStatus.devPlanPaygEnabled ?? false}
				regularCredits={parseFloat(devPlanStatus.regularCredits ?? "0")}
				autoTopUpEnabled={devPlanStatus.autoTopUpEnabled ?? false}
				autoTopUpThreshold={devPlanStatus.autoTopUpThreshold ?? null}
				autoTopUpAmount={devPlanStatus.autoTopUpAmount ?? null}
			/>
		</div>
	);
}
