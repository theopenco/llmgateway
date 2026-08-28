"use client";

import { currencyFormatter } from "@/components/analytics/chart-helpers";
import { useMyMemberBudget } from "@/hooks/useTeam";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";

import type { MyMemberBudgetData } from "@/hooks/useTeam";

function periodLabel(value: number, unit: string): string {
	return value === 1 ? unit : `${value} ${unit}s`;
}

/**
 * Shows the authenticated member their own assigned budget limits (max active
 * API keys, total spend cap, rolling period cap) and current usage against
 * them. Renders nothing when no limits are set, so it stays out of the way for
 * unrestricted members.
 *
 * `initialData` is fetched server-side so the card renders filled in on the
 * first paint instead of popping in after hydration.
 */
export function MemberLimitsCard({
	organizationId,
	initialData,
}: {
	organizationId: string;
	initialData?: MyMemberBudgetData;
}) {
	const { data } = useMyMemberBudget(organizationId, initialData);

	const budget = data?.budget ?? null;
	const teamBudget = data?.teamBudget ?? null;
	const spend = data?.spend ?? null;

	const policies = [
		...(teamBudget
			? [{ label: `${data?.team?.name ?? "Team"} policy`, budget: teamBudget }]
			: []),
		...(budget
			? [{ label: "Personal or organization default policy", budget }]
			: []),
	].filter(
		({ budget: policy }) =>
			policy.maxApiKeys !== null ||
			policy.usageLimit !== null ||
			policy.periodUsageLimit !== null,
	);

	if (!spend || policies.length === 0) {
		return null;
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">Your usage limits</CardTitle>
				<CardDescription>
					Each policy is enforced independently. API keys must stay within both
					team and member ceilings.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				{policies.map(({ label, budget: policy }) => {
					const periodSpend = spend.currentPeriods.find(
						(period) =>
							period.durationValue === policy.periodUsageDurationValue &&
							period.durationUnit === policy.periodUsageDurationUnit,
					)?.usage;

					return (
						<div key={label} className="space-y-3">
							<div className="text-sm font-medium">{label}</div>
							<div className="grid gap-6 sm:grid-cols-3">
								{policy.usageLimit !== null && (
									<div>
										<div className="text-muted-foreground text-xs">
											Total spend
										</div>
										<div className="text-lg font-semibold">
											{currencyFormatter.format(spend.lifetime)}
											<span className="text-muted-foreground text-sm font-normal">
												{" / "}
												{currencyFormatter.format(Number(policy.usageLimit))}
											</span>
										</div>
										<div className="text-muted-foreground text-xs">
											of total limit
										</div>
									</div>
								)}

								{policy.periodUsageLimit !== null &&
									policy.periodUsageDurationValue !== null &&
									policy.periodUsageDurationUnit !== null && (
										<div>
											<div className="text-muted-foreground text-xs">
												Period spend
											</div>
											<div className="text-lg font-semibold">
												{periodSpend !== undefined
													? currencyFormatter.format(periodSpend)
													: "—"}
												<span className="text-muted-foreground text-sm font-normal">
													{" / "}
													{currencyFormatter.format(
														Number(policy.periodUsageLimit),
													)}
												</span>
											</div>
											<div className="text-muted-foreground text-xs">
												{`per ${periodLabel(
													policy.periodUsageDurationValue,
													policy.periodUsageDurationUnit,
												)}`}
											</div>
										</div>
									)}

								{policy.maxApiKeys !== null && (
									<div>
										<div className="text-muted-foreground text-xs">
											Active API keys
										</div>
										<div className="text-lg font-semibold">
											{spend.activeApiKeys}
											<span className="text-muted-foreground text-sm font-normal">
												{" / "}
												{policy.maxApiKeys}
											</span>
										</div>
										<div className="text-muted-foreground text-xs">
											of key limit
										</div>
									</div>
								)}
							</div>
						</div>
					);
				})}
			</CardContent>
		</Card>
	);
}
