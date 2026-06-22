"use client";

import { format, subDays } from "date-fns";
import { BarChart3Icon, KeyRound, Mail, Users } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { currencyFormatter } from "@/components/analytics/chart-helpers";
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

import type { Route } from "next";

function EnterpriseUpgradeCard() {
	return (
		<Card className="max-w-2xl">
			<CardHeader>
				<CardTitle>Enterprise Feature</CardTitle>
				<CardDescription>
					Per-member usage analytics are available on the Enterprise plan
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				<p className="text-muted-foreground">
					See exactly how much each team member is spending — cost, tokens, and
					the models, providers, and apps they use most — over any time period.
				</p>
				<Button asChild>
					<a href="mailto:contact@llmgateway.io">
						<Mail className="mr-2 h-4 w-4" />
						Contact Sales
					</a>
				</Button>
			</CardContent>
		</Card>
	);
}

function ApiKeyAnalyticsCallout({ href }: { href: Route }) {
	return (
		<div className="from-primary/5 via-card to-card relative overflow-hidden rounded-lg border bg-gradient-to-br p-4 sm:p-5">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex items-start gap-3">
					<div className="bg-background flex h-10 w-10 shrink-0 items-center justify-center rounded-md border">
						<KeyRound className="text-primary h-5 w-5" />
					</div>
					<div className="space-y-1">
						<h3 className="text-sm font-semibold">
							Prefer to track usage by API key?
						</h3>
						<p className="text-muted-foreground max-w-xl text-sm">
							Every API key has the same breakdown you see here — cost, tokens,
							requests, and a model-by-model view over time. Handy when your
							usage runs through services, not just people.
						</p>
					</div>
				</div>
				<Button asChild variant="outline" className="shrink-0">
					<Link href={href} prefetch={true}>
						<BarChart3Icon className="mr-2 h-4 w-4" />
						View API key analytics
					</Link>
				</Button>
			</div>
		</div>
	);
}

export function MembersClient() {
	const params = useParams();
	const organizationId = params.orgId as string;
	const router = useRouter();
	const searchParams = useSearchParams();
	const { buildUrl, buildOrgUrl, selectedOrganization } =
		useDashboardNavigation();
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
				`${buildOrgUrl("org/members")}?${params2.toString()}` as Route,
			);
		}
	}, [searchParams, router, buildOrgUrl]);

	const fromStr =
		searchParams.get("from") ?? format(subDays(new Date(), 6), "yyyy-MM-dd");
	const toStr = searchParams.get("to") ?? format(new Date(), "yyyy-MM-dd");

	const { data, isLoading, error } = api.useQuery(
		"get",
		"/analytics/members",
		{ params: { query: { organizationId, from: fromStr, to: toStr } } },
		{ enabled: !!organizationId && isEnterprise && isAdmin },
	);

	const members = data?.members ?? [];

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
					<div>
						<h2 className="text-3xl font-bold tracking-tight">Members</h2>
						<p className="text-muted-foreground">
							Usage by team member for the selected period
						</p>
					</div>
					{isEnterprise && isAdmin && (
						<DateRangePicker buildUrl={buildOrgUrl} path="org/members" />
					)}
				</div>

				{!isEnterprise ? (
					<EnterpriseUpgradeCard />
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
						<ApiKeyAnalyticsCallout href={buildUrl("api-keys")} />
						<Card>
							<CardHeader>
								<CardTitle className="flex items-center gap-2 text-base">
									<Users className="h-4 w-4" />
									Team members
								</CardTitle>
								<CardDescription>
									Cost is attributed to the member who created each API key.
								</CardDescription>
							</CardHeader>
							<CardContent>
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Member</TableHead>
											<TableHead>Role</TableHead>
											<TableHead className="text-right">Cost</TableHead>
											<TableHead className="text-right">Tokens</TableHead>
											<TableHead className="text-right">Requests</TableHead>
											<TableHead className="text-right">Error rate</TableHead>
											<TableHead className="text-right">API keys</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{isLoading ? (
											<TableRow>
												<TableCell
													colSpan={7}
													className="py-10 text-center text-muted-foreground"
												>
													Loading…
												</TableCell>
											</TableRow>
										) : error ? (
											<TableRow>
												<TableCell
													colSpan={7}
													className="text-destructive py-10 text-center"
												>
													Failed to load member usage. Please try again.
												</TableCell>
											</TableRow>
										) : members.length === 0 ? (
											<TableRow>
												<TableCell
													colSpan={7}
													className="py-10 text-center text-muted-foreground"
												>
													No members found
												</TableCell>
											</TableRow>
										) : (
											members.map((member) => {
												const errorRate =
													member.requestCount > 0
														? (member.errorCount / member.requestCount) * 100
														: 0;
												return (
													<TableRow key={member.userId}>
														<TableCell>
															<Link
																href={
																	`${buildOrgUrl(
																		`org/members/${member.userId}`,
																	)}?from=${fromStr}&to=${toStr}` as Route
																}
																className="font-medium hover:underline"
															>
																{member.name || member.email}
															</Link>
															{member.name && (
																<div className="text-xs text-muted-foreground">
																	{member.email}
																</div>
															)}
														</TableCell>
														<TableCell className="capitalize text-muted-foreground">
															{member.role}
														</TableCell>
														<TableCell className="text-right font-medium">
															{currencyFormatter.format(member.cost)}
														</TableCell>
														<TableCell className="text-right">
															{member.totalTokens.toLocaleString()}
														</TableCell>
														<TableCell className="text-right">
															{member.requestCount.toLocaleString()}
														</TableCell>
														<TableCell className="text-right">
															{errorRate.toFixed(1)}%
														</TableCell>
														<TableCell className="text-right">
															{member.apiKeyCount}
														</TableCell>
													</TableRow>
												);
											})
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
