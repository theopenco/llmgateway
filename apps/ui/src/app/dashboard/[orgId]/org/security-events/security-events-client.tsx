"use client";

import { format } from "date-fns";
import { AlertTriangle, ShieldAlert, ShieldCheck, Eye } from "lucide-react";
import { useParams } from "next/navigation";
import { useState, useEffect, useCallback } from "react";

import { useIsMobile } from "@/hooks/use-mobile";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { useTeamMembers } from "@/hooks/useTeam";
import { useUser } from "@/hooks/useUser";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import { useFetchClient } from "@/lib/fetch-client";

import { ContactSalesCard } from "./contact-sales-card";

interface Violation {
	id: string;
	createdAt: string;
	ruleId: string;
	ruleName: string;
	category: string;
	actionTaken: "blocked" | "redacted" | "warned";
	matchedPattern: string | null;
	matchedContent: string | null;
	logId: string | null;
	apiKeyId: string | null;
	model: string | null;
}

interface ViolationsResponse {
	violations: Violation[];
	pagination: {
		nextCursor: string | null;
		hasMore: boolean;
		limit: number;
	};
}

interface Stats {
	totalViolations: number;
	last24Hours: number;
	last7Days: number;
	byAction: {
		blocked: number;
		redacted: number;
		warned: number;
	};
	byCategory: Record<string, number>;
}

function getActionBadgeVariant(
	action: string,
): "default" | "secondary" | "destructive" | "outline" {
	if (action === "blocked") {
		return "destructive";
	}
	if (action === "redacted") {
		return "secondary";
	}
	return "outline";
}

function getActionIcon(action: string) {
	if (action === "blocked") {
		return <ShieldAlert className="h-4 w-4" />;
	}
	if (action === "redacted") {
		return <Eye className="h-4 w-4" />;
	}
	return <AlertTriangle className="h-4 w-4" />;
}

export function SecurityEventsClient() {
	const params = useParams();
	const organizationId = params.orgId as string;
	const fetchClient = useFetchClient();
	const isMobile = useIsMobile();
	const { selectedOrganization } = useDashboardNavigation();
	const { user } = useUser();
	const { data: teamData, isLoading: isLoadingTeam } =
		useTeamMembers(organizationId);

	const currentUserRole = teamData?.members.find(
		(member) => member.userId === user?.id,
	)?.role;

	const [violations, setViolations] = useState<Violation[]>([]);
	const [stats, setStats] = useState<Stats | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [isLoadingMore, setIsLoadingMore] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [hasMore, setHasMore] = useState(false);

	// Filters
	const [actionFilter, setActionFilter] = useState<string>("all");
	const [categoryFilter, setCategoryFilter] = useState<string>("all");

	const canViewEvents =
		selectedOrganization?.plan === "enterprise" &&
		(currentUserRole === "owner" || currentUserRole === "admin");

	const fetchStats = useCallback(async () => {
		try {
			const response = await fetchClient.GET(
				"/guardrails/stats/{organizationId}",
				{
					params: { path: { organizationId } },
				},
			);

			if (response.data) {
				setStats(response.data as unknown as Stats);
			}
		} catch {
			// Silently fail for stats
		}
	}, [fetchClient, organizationId]);

	const fetchViolations = useCallback(
		async (cursor?: string) => {
			try {
				const isInitialLoad = !cursor;
				if (isInitialLoad) {
					setIsLoading(true);
				} else {
					setIsLoadingMore(true);
				}

				const queryParams: Record<string, string> = {};
				if (cursor) {
					queryParams.cursor = cursor;
				}
				if (actionFilter !== "all") {
					queryParams.action = actionFilter;
				}
				if (categoryFilter !== "all") {
					queryParams.category = categoryFilter;
				}

				const response = await fetchClient.GET(
					"/guardrails/violations/{organizationId}",
					{
						params: {
							path: { organizationId },
							query: queryParams,
						},
					},
				);

				if (!response.data) {
					setError("Failed to load security events");
					return;
				}

				const data = response.data as unknown as ViolationsResponse;

				if (isInitialLoad) {
					setViolations(data.violations);
				} else {
					setViolations((prev) => [...prev, ...data.violations]);
				}

				setNextCursor(data.pagination.nextCursor);
				setHasMore(data.pagination.hasMore);
				setError(null);
			} catch {
				setError("Failed to load security events");
			} finally {
				setIsLoading(false);
				setIsLoadingMore(false);
			}
		},
		[fetchClient, organizationId, actionFilter, categoryFilter],
	);

	// Reset and refetch when filters or view permissions change
	useEffect(() => {
		if (canViewEvents) {
			setViolations([]);
			setNextCursor(null);
			void fetchStats();
			void fetchViolations();
		} else {
			setIsLoading(false);
		}
	}, [
		canViewEvents,
		fetchStats,
		fetchViolations,
		actionFilter,
		categoryFilter,
	]);

	if (selectedOrganization?.plan !== "enterprise") {
		return <ContactSalesCard />;
	}

	if (isLoadingTeam || !currentUserRole) {
		return (
			<div className="flex items-center justify-center py-12">
				<div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
			</div>
		);
	}

	if (currentUserRole !== "owner" && currentUserRole !== "admin") {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Access Denied</CardTitle>
					<CardDescription>
						Only organization owners and admins can view security events.
					</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	return (
		<div className="space-y-6">
			{/* Stats Cards */}
			{stats && (
				<div className="grid gap-4 md:grid-cols-4">
					<Card>
						<CardHeader className="pb-2">
							<CardDescription>Total Violations</CardDescription>
							<CardTitle className="text-3xl">
								{stats.totalViolations}
							</CardTitle>
						</CardHeader>
					</Card>
					<Card>
						<CardHeader className="pb-2">
							<CardDescription>Last 24 Hours</CardDescription>
							<CardTitle className="text-3xl">{stats.last24Hours}</CardTitle>
						</CardHeader>
					</Card>
					<Card>
						<CardHeader className="pb-2">
							<CardDescription>Blocked</CardDescription>
							<CardTitle className="text-3xl text-destructive">
								{stats.byAction.blocked}
							</CardTitle>
						</CardHeader>
					</Card>
					<Card>
						<CardHeader className="pb-2">
							<CardDescription>Redacted</CardDescription>
							<CardTitle className="text-3xl text-orange-500">
								{stats.byAction.redacted}
							</CardTitle>
						</CardHeader>
					</Card>
				</div>
			)}

			{/* Violations List */}
			<Card>
				<CardHeader>
					<CardTitle>Security Events</CardTitle>
					<CardDescription>
						View all guardrail violations and security events
					</CardDescription>
				</CardHeader>
				<CardContent>
					{/* Filters */}
					<div className="flex flex-wrap gap-4 mb-6">
						<div className="flex items-center gap-2">
							<label
								htmlFor="action-filter"
								className="text-sm font-medium text-muted-foreground"
							>
								Action:
							</label>
							<Select value={actionFilter} onValueChange={setActionFilter}>
								<SelectTrigger id="action-filter" className="w-[140px]">
									<SelectValue placeholder="All actions" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All actions</SelectItem>
									<SelectItem value="blocked">Blocked</SelectItem>
									<SelectItem value="redacted">Redacted</SelectItem>
									<SelectItem value="warned">Warned</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="flex items-center gap-2">
							<label
								htmlFor="category-filter"
								className="text-sm font-medium text-muted-foreground"
							>
								Category:
							</label>
							<Select value={categoryFilter} onValueChange={setCategoryFilter}>
								<SelectTrigger id="category-filter" className="w-[180px]">
									<SelectValue placeholder="All categories" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All categories</SelectItem>
									<SelectItem value="prompt_injection">
										Prompt Injection
									</SelectItem>
									<SelectItem value="jailbreak">Jailbreak</SelectItem>
									<SelectItem value="pii_detection">PII Detection</SelectItem>
									<SelectItem value="secrets">Secrets</SelectItem>
									<SelectItem value="blocked_terms">Blocked Terms</SelectItem>
									<SelectItem value="custom_regex">Custom Regex</SelectItem>
									<SelectItem value="topic_restriction">
										Topic Restriction
									</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>

					{/* Error state */}
					{error && (
						<div className="p-4 mb-4 text-sm text-red-800 bg-red-100 rounded-lg dark:bg-red-900/20 dark:text-red-400">
							{error}
						</div>
					)}

					{/* Loading state */}
					{isLoading && (
						<div className="flex items-center justify-center py-12">
							<div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
						</div>
					)}

					{/* Violations table */}
					{!isLoading && !error && (
						<>
							{isMobile ? (
								<div className="space-y-4">
									{violations.map((violation) => (
										<Card key={violation.id}>
											<CardContent className="pt-4">
												<div className="flex flex-col gap-2">
													<div className="flex items-center justify-between">
														<Badge
															variant={getActionBadgeVariant(
																violation.actionTaken,
															)}
															className="flex items-center gap-1"
														>
															{getActionIcon(violation.actionTaken)}
															{violation.actionTaken}
														</Badge>
														<span className="text-xs text-muted-foreground">
															{format(new Date(violation.createdAt), "PPp")}
														</span>
													</div>
													<div className="text-sm font-medium">
														{violation.ruleName}
													</div>
													<div className="flex items-center gap-2 text-sm text-muted-foreground">
														<Badge variant="outline" className="text-xs">
															{violation.category}
														</Badge>
													</div>
													{violation.matchedPattern && (
														<div className="text-xs text-muted-foreground truncate">
															Pattern: {violation.matchedPattern}
														</div>
													)}
												</div>
											</CardContent>
										</Card>
									))}
								</div>
							) : (
								<div className="rounded-md border overflow-hidden">
									<table className="w-full">
										<thead className="bg-muted/50">
											<tr>
												<th className="p-4 text-left text-sm font-medium text-muted-foreground">
													Timestamp
												</th>
												<th className="p-4 text-left text-sm font-medium text-muted-foreground">
													Rule
												</th>
												<th className="p-4 text-left text-sm font-medium text-muted-foreground">
													Category
												</th>
												<th className="p-4 text-left text-sm font-medium text-muted-foreground">
													Action
												</th>
												<th className="p-4 text-left text-sm font-medium text-muted-foreground">
													Details
												</th>
											</tr>
										</thead>
										<tbody className="divide-y">
											{violations.map((violation) => (
												<tr
													key={violation.id}
													className="hover:bg-muted/25 transition-colors"
												>
													<td className="p-4 align-middle text-sm whitespace-nowrap">
														{format(new Date(violation.createdAt), "PPp")}
													</td>
													<td className="p-4 align-middle">
														<span className="text-sm font-medium">
															{violation.ruleName}
														</span>
													</td>
													<td className="p-4 align-middle whitespace-nowrap">
														<Badge variant="outline" className="text-xs">
															{violation.category}
														</Badge>
													</td>
													<td className="p-4 align-middle">
														<Badge
															variant={getActionBadgeVariant(
																violation.actionTaken,
															)}
															className="flex items-center gap-1 w-fit"
														>
															{getActionIcon(violation.actionTaken)}
															{violation.actionTaken}
														</Badge>
													</td>
													<td className="p-4 align-middle text-sm text-muted-foreground max-w-xs truncate">
														{violation.matchedPattern ?? "—"}
													</td>
												</tr>
											))}
											{violations.length === 0 && (
												<tr>
													<td
														colSpan={5}
														className="p-8 text-center text-muted-foreground"
													>
														<div className="flex flex-col items-center gap-2">
															<ShieldCheck className="h-12 w-12 text-muted-foreground/50" />
															<span>No security events found</span>
														</div>
													</td>
												</tr>
											)}
										</tbody>
									</table>
								</div>
							)}
							{hasMore && (
								<div className="flex justify-center pt-4">
									<Button
										onClick={() => fetchViolations(nextCursor ?? undefined)}
										disabled={isLoadingMore}
										variant="outline"
									>
										{isLoadingMore ? "Loading..." : "Load More"}
									</Button>
								</div>
							)}
						</>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
