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

function periodLabel(value: number, unit: string): string {
	return value === 1 ? unit : `${value} ${unit}s`;
}

/**
 * Shows the authenticated member their own assigned budget limits (max active
 * API keys, total spend cap, rolling period cap) and current usage against
 * them. Renders nothing when no limits are set, so it stays out of the way for
 * unrestricted members.
 */
export function MemberLimitsCard({
	organizationId,
}: {
	organizationId: string;
}) {
	const { data } = useMyMemberBudget(organizationId);

	const budget = data?.budget ?? null;
	const spend = data?.spend ?? null;

	const hasLimits =
		!!budget &&
		(budget.maxApiKeys !== null ||
			budget.usageLimit !== null ||
			budget.periodUsageLimit !== null);

	if (!budget || !spend || !hasLimits) {
		return null;
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">Your usage limits</CardTitle>
				<CardDescription>
					An organization admin has set the following limits on your account.
					They are enforced on the gateway at request time.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="grid gap-6 sm:grid-cols-3">
					{budget.usageLimit !== null && (
						<div>
							<div className="text-muted-foreground text-xs">Total spend</div>
							<div className="text-lg font-semibold">
								{currencyFormatter.format(spend.lifetime)}
								<span className="text-muted-foreground text-sm font-normal">
									{" / "}
									{currencyFormatter.format(Number(budget.usageLimit))}
								</span>
							</div>
							<div className="text-muted-foreground text-xs">
								of total limit
							</div>
						</div>
					)}

					{budget.periodUsageLimit !== null &&
						budget.periodUsageDurationValue !== null &&
						budget.periodUsageDurationUnit !== null && (
							<div>
								<div className="text-muted-foreground text-xs">
									Period spend
								</div>
								<div className="text-lg font-semibold">
									{spend.currentPeriod !== null
										? currencyFormatter.format(spend.currentPeriod)
										: "—"}
									<span className="text-muted-foreground text-sm font-normal">
										{" / "}
										{currencyFormatter.format(Number(budget.periodUsageLimit))}
									</span>
								</div>
								<div className="text-muted-foreground text-xs">
									{`per ${periodLabel(
										budget.periodUsageDurationValue,
										budget.periodUsageDurationUnit,
									)}`}
								</div>
							</div>
						)}

					{budget.maxApiKeys !== null && (
						<div>
							<div className="text-muted-foreground text-xs">
								Active API keys
							</div>
							<div className="text-lg font-semibold">
								{spend.activeApiKeys}
								<span className="text-muted-foreground text-sm font-normal">
									{" / "}
									{budget.maxApiKeys}
								</span>
							</div>
							<div className="text-muted-foreground text-xs">of key limit</div>
						</div>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
