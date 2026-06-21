"use client";

import { format, subDays } from "date-fns";
import { ArrowLeftIcon, Boxes, Mail, Sparkles } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { currencyFormatter } from "@/components/analytics/chart-helpers";
import { CostByModelCard } from "@/components/analytics/cost-by-model-card";
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

	const currentUserRole = teamData?.members.find(
		(member) => member.userId === user?.id,
	)?.role;
	const isAdmin = currentUserRole === "owner" || currentUserRole === "admin";
	const isEnterprise = selectedOrganization?.plan === "enterprise";

	useEffect(() => {
		if (!searchParams.get("from") || !searchParams.get("to")) {
			const params2 = new URLSearchParams(searchParams.toString());
			params2.delete("days");
			const today = new Date();
			params2.set("from", format(subDays(today, 6), "yyyy-MM-dd"));
			params2.set("to", format(today, "yyyy-MM-dd"));
			router.replace(
				`${buildOrgUrl(`org/members/${userId}`)}?${params2.toString()}` as Route,
			);
		}
	}, [searchParams, router, buildOrgUrl, userId]);

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
		{ enabled: !!organizationId && !!userId && isEnterprise && isAdmin },
	);

	const summary = data?.summary;
	const errorRate =
		summary && summary.requestCount > 0
			? (summary.errorCount / summary.requestCount) * 100
			: 0;

	const activity: ActivityRow[] = data
		? [
				{
					date: fromStr,
					modelBreakdown: data.costByModel.map((c) => ({
						id: c.key,
						provider: "",
						requestCount: c.requestCount,
						inputTokens: 0,
						outputTokens: 0,
						totalTokens: c.totalTokens,
						cost: c.cost,
					})),
				},
			]
		: [];

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

	const memberName = data?.member.name || data?.member.email || "Member";

	if (!isEnterprise || !isAdmin) {
		return (
			<div className="flex flex-col">
				<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
					<Link
						href={
							`${buildOrgUrl("org/members")}?from=${fromStr}&to=${toStr}` as Route
						}
						className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
						prefetch={true}
					>
						<ArrowLeftIcon className="h-4 w-4" />
						Back to members
					</Link>
					{!isEnterprise ? (
						<Card className="max-w-2xl">
							<CardHeader>
								<CardTitle>Enterprise Feature</CardTitle>
								<CardDescription>
									Per-member usage analytics are available on the Enterprise
									plan
								</CardDescription>
							</CardHeader>
							<CardContent>
								<Button asChild>
									<a href="mailto:contact@llmgateway.io">
										<Mail className="mr-2 h-4 w-4" />
										Contact Sales
									</a>
								</Button>
							</CardContent>
						</Card>
					) : (
						<Card className="max-w-2xl">
							<CardHeader>
								<CardTitle>Admins only</CardTitle>
								<CardDescription>
									Only organization owners and admins can view member usage.
								</CardDescription>
							</CardHeader>
						</Card>
					)}
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<Link
					href={
						`${buildOrgUrl("org/members")}?from=${fromStr}&to=${toStr}` as Route
					}
					className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
					prefetch={true}
				>
					<ArrowLeftIcon className="h-4 w-4" />
					Back to members
				</Link>

				<div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
					<div className="min-w-0">
						<h2 className="truncate text-3xl font-bold tracking-tight">
							{memberName}
						</h2>
						{data?.member.name && (
							<p className="text-sm text-muted-foreground">
								{data.member.email}
							</p>
						)}
					</div>
					<DateRangePicker
						buildUrl={buildOrgUrl}
						path={`org/members/${userId}`}
					/>
				</div>

				<div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
					{stats.map((stat) => (
						<Card key={stat.label}>
							<CardHeader className="pb-2">
								<CardTitle className="text-xs font-medium text-muted-foreground">
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
								<CardTitle className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
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
											className="py-6 text-center text-muted-foreground"
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
			</div>
		</div>
	);
}
