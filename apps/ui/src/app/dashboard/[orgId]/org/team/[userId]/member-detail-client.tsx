"use client";

import { format, subDays } from "date-fns";
import { ArrowLeftIcon, Boxes, Mail, Sparkles } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { currencyFormatter } from "@/components/analytics/chart-helpers";
import { CostByModelCard } from "@/components/analytics/cost-by-model-card";
import { CostByModelOverTimeCard } from "@/components/analytics/cost-by-model-over-time-card";
import { DateRangePicker } from "@/components/date-range-picker";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { useTeamMembers } from "@/hooks/useTeam";
import { useUser } from "@/hooks/useUser";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/lib/components/table";
import { useApi } from "@/lib/fetch-client";

import type { ActivityRow } from "@/components/analytics/chart-helpers";
import type { Route } from "next";

function periodLabel(value: number, unit: string): string {
	return value === 1 ? unit : `${value} ${unit}s`;
}

export function MemberDetailClient() {
	const params = useParams();
	const organizationId = params.orgId as string;
	const userId = params.userId as string;
	const router = useRouter();
	const searchParams = useSearchParams();
	const { buildOrgUrl, selectedOrganization } = useDashboardNavigation();
	const api = useApi();
	const { user } = useUser();
	const { data: teamData } = useTeamMembers(organizationId);

	const teamMember = teamData?.members.find(
		(member) => member.userId === userId,
	);
	const budget = teamMember?.budget ?? null;
	const spend = teamMember?.spend ?? null;
	const currentUserRole = teamData?.members.find(
		(member) => member.userId === user?.id,
	)?.role;
	const isAdmin = currentUserRole === "owner" || currentUserRole === "admin";
	const isEnterprise = selectedOrganization?.plan === "enterprise";
	const showUsage = isEnterprise && isAdmin;

	useEffect(() => {
		if (!showUsage) {
			return;
		}
		if (!searchParams.get("from") || !searchParams.get("to")) {
			const params2 = new URLSearchParams(searchParams.toString());
			params2.delete("days");
			const today = new Date();
			params2.set("from", format(subDays(today, 6), "yyyy-MM-dd"));
			params2.set("to", format(today, "yyyy-MM-dd"));
			router.replace(
				`${buildOrgUrl(`org/team/${userId}`)}?${params2.toString()}` as Route,
			);
		}
	}, [showUsage, searchParams, router, buildOrgUrl, userId]);

	const fromStr =
		searchParams.get("from") ?? format(subDays(new Date(), 6), "yyyy-MM-dd");
	const toStr = searchParams.get("to") ?? format(new Date(), "yyyy-MM-dd");

	const { data, isLoading } = api.useQuery(
		"get",
		"/analytics/members/{userId}",
		{
			params: {
				path: { userId },
				query: { organizationId, from: fromStr, to: toStr },
			},
		},
		{ enabled: !!organizationId && !!userId && showUsage },
	);

	const summary = data?.summary;
	const errorRate =
		summary && summary.requestCount > 0
			? (summary.errorCount / summary.requestCount) * 100
			: 0;

	const activity = (data?.activity ?? []) as ActivityRow[];

	const stats = [
		{
			label: "Total Cost",
			value: currencyFormatter.format(summary?.cost ?? 0),
		},
		{
			label: "Total Tokens",
			value: (summary?.totalTokens ?? 0).toLocaleString(),
		},
		{ label: "Requests", value: (summary?.requestCount ?? 0).toLocaleString() },
		{ label: "Error Rate", value: `${errorRate.toFixed(1)}%` },
		{ label: "API Keys", value: (summary?.apiKeyCount ?? 0).toLocaleString() },
	];

	const mostUsed = [
		{
			label: "Most used model",
			value: data?.topModels[0]?.key ?? "—",
			icon: Sparkles,
		},
		{
			label: "Most used provider",
			value: data?.topProviders[0]?.key ?? "—",
			icon: Boxes,
		},
	];

	const memberName =
		teamMember?.user.name ||
		teamMember?.user.email ||
		data?.member.name ||
		data?.member.email ||
		"Member";
	const memberEmail = teamMember?.user.email ?? data?.member.email;
	const memberRole = teamMember?.role;

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<Link
					href={
						`${buildOrgUrl("org/team")}?from=${fromStr}&to=${toStr}` as Route
					}
					className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
					prefetch={true}
				>
					<ArrowLeftIcon className="h-4 w-4" />
					Back to team
				</Link>

				<div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
					<div className="min-w-0">
						<h2 className="truncate text-3xl font-bold tracking-tight">
							{memberName}
						</h2>
						<div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 text-sm">
							{memberEmail && memberName !== memberEmail && (
								<span>{memberEmail}</span>
							)}
							{memberRole && <span className="capitalize">{memberRole}</span>}
						</div>
					</div>
					{showUsage && (
						<DateRangePicker
							buildUrl={buildOrgUrl}
							path={`org/team/${userId}`}
						/>
					)}
				</div>

				{isAdmin && budget && spend && (
					<Card>
						<CardHeader>
							<CardTitle className="text-base">Budget &amp; limits</CardTitle>
							<CardDescription>
								Spend and API-key caps for this member, enforced on the gateway
								at request time. Manage them from the{" "}
								<Link
									href={
										`${buildOrgUrl("org/team")}?from=${fromStr}&to=${toStr}` as Route
									}
									className="underline"
								>
									team page
								</Link>
								.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<div className="grid gap-6 sm:grid-cols-3">
								<div>
									<div className="text-muted-foreground text-xs">
										Total spend
									</div>
									<div className="text-lg font-semibold">
										{currencyFormatter.format(spend.lifetime)}
										{budget.usageLimit !== null && (
											<span className="text-muted-foreground text-sm font-normal">
												{" / "}
												{currencyFormatter.format(Number(budget.usageLimit))}
											</span>
										)}
									</div>
									<div className="text-muted-foreground text-xs">
										{budget.usageLimit !== null ? "of total limit" : "no limit"}
									</div>
								</div>

								<div>
									<div className="text-muted-foreground text-xs">
										Period spend
									</div>
									<div className="text-lg font-semibold">
										{spend.currentPeriod !== null
											? currencyFormatter.format(spend.currentPeriod)
											: "—"}
										{budget.periodUsageLimit !== null && (
											<span className="text-muted-foreground text-sm font-normal">
												{" / "}
												{currencyFormatter.format(
													Number(budget.periodUsageLimit),
												)}
											</span>
										)}
									</div>
									<div className="text-muted-foreground text-xs">
										{budget.periodUsageLimit !== null &&
										budget.periodUsageDurationValue !== null &&
										budget.periodUsageDurationUnit !== null
											? `per ${periodLabel(
													budget.periodUsageDurationValue,
													budget.periodUsageDurationUnit,
												)}`
											: "no limit"}
									</div>
								</div>

								<div>
									<div className="text-muted-foreground text-xs">
										Active API keys
									</div>
									<div className="text-lg font-semibold">
										{spend.activeApiKeys}
										{budget.maxApiKeys !== null && (
											<span className="text-muted-foreground text-sm font-normal">
												{" / "}
												{budget.maxApiKeys}
											</span>
										)}
									</div>
									<div className="text-muted-foreground text-xs">
										{budget.maxApiKeys !== null ? "of key limit" : "no limit"}
									</div>
								</div>
							</div>
						</CardContent>
					</Card>
				)}

				{!isEnterprise ? (
					<Card className="max-w-2xl">
						<CardHeader>
							<CardTitle>Enterprise Feature</CardTitle>
							<CardDescription>
								Per-member usage analytics are available on the Enterprise plan
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<p className="text-muted-foreground text-sm">
								Upgrade to Enterprise to see this member's cost, tokens,
								requests, and the models, providers, and apps they use most —
								over any time period.
							</p>
							<Button asChild>
								<a href="mailto:contact@llmgateway.io">
									<Mail className="mr-2 h-4 w-4" />
									Contact Sales
								</a>
							</Button>
						</CardContent>
					</Card>
				) : !isAdmin ? (
					<Card className="max-w-2xl">
						<CardHeader>
							<CardTitle>Admins only</CardTitle>
							<CardDescription>
								Only organization owners and admins can view member usage.
							</CardDescription>
						</CardHeader>
					</Card>
				) : (
					<>
						<div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
							{stats.map((stat) => (
								<Card key={stat.label}>
									<CardHeader className="pb-2">
										<CardTitle className="text-muted-foreground text-xs font-medium">
											{stat.label}
										</CardTitle>
									</CardHeader>
									<CardContent>
										<div className="text-2xl font-bold">
											{isLoading ? "—" : stat.value}
										</div>
									</CardContent>
								</Card>
							))}
						</div>

						<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
							{mostUsed.map((item) => (
								<Card key={item.label}>
									<CardHeader className="pb-2">
										<CardTitle className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
											<item.icon className="h-4 w-4" />
											{item.label}
										</CardTitle>
									</CardHeader>
									<CardContent>
										<div className="truncate text-lg font-semibold">
											{isLoading ? "—" : item.value}
										</div>
									</CardContent>
								</Card>
							))}
						</div>

						<CostByModelOverTimeCard
							activity={activity}
							loading={isLoading}
							description={`Usage over time by model for ${memberName}`}
						/>

						<CostByModelCard
							activity={activity}
							loading={isLoading}
							description={`Top models by cost for ${memberName}`}
						/>

						<Card>
							<CardHeader>
								<CardTitle className="text-base">Top providers</CardTitle>
							</CardHeader>
							<CardContent>
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Provider</TableHead>
											<TableHead className="text-right">Cost</TableHead>
											<TableHead className="text-right">Requests</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{(data?.topProviders.length ?? 0) === 0 ? (
											<TableRow>
												<TableCell
													colSpan={3}
													className="text-muted-foreground py-6 text-center"
												>
													No data
												</TableCell>
											</TableRow>
										) : (
											data?.topProviders.map((p) => (
												<TableRow key={p.key}>
													<TableCell className="font-medium">{p.key}</TableCell>
													<TableCell className="text-right">
														{currencyFormatter.format(p.cost)}
													</TableCell>
													<TableCell className="text-right">
														{p.requestCount.toLocaleString()}
													</TableCell>
												</TableRow>
											))
										)}
									</TableBody>
								</Table>
							</CardContent>
						</Card>
					</>
				)}
			</div>
		</div>
	);
}
