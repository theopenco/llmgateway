"use client";

import { format } from "date-fns";
import { Check, Copy } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
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

interface AuditLog {
	id: string;
	createdAt: string;
	organizationId: string;
	userId: string;
	action: string;
	resourceType: string;
	resourceId: string | null;
	metadata: Record<string, unknown> | null;
	user?: {
		id: string;
		email: string;
		name: string | null;
	};
}

interface AuditLogsResponse {
	auditLogs: AuditLog[];
	pagination: {
		nextCursor: string | null;
		hasMore: boolean;
		limit: number;
	};
}

interface FilterOptions {
	actions: string[];
	resourceTypes: string[];
	users: Array<{ id: string; email: string; name: string | null }>;
}

function formatAction(action: string): string {
	return action.replace(/\./g, " → ");
}

function formatResourceType(resourceType: string): string {
	const specialCases: Record<string, string> = {
		api: "API",
		iam: "IAM",
	};

	return resourceType
		.split("_")
		.map((part) => specialCases[part] ?? part)
		.join(" ");
}

function getActionBadgeVariant(
	action: string,
): "default" | "secondary" | "destructive" | "outline" {
	if (action.includes("delete") || action.includes("remove")) {
		return "destructive";
	}
	if (action.includes("create") || action.includes("add")) {
		return "default";
	}
	return "outline";
}

export function AuditLogsClient() {
	const params = useParams();
	const router = useRouter();
	const searchParams = useSearchParams();
	const organizationId = params.orgId as string;
	const fetchClient = useFetchClient();
	const isMobile = useIsMobile();
	const { selectedOrganization } = useDashboardNavigation();
	const { user } = useUser();
	const { data: teamData, isLoading: isLoadingTeam } =
		useTeamMembers(organizationId);

	// Get current user's role from team members
	const currentUserRole = teamData?.members.find(
		(member) => member.userId === user?.id,
	)?.role;

	const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [isLoadingMore, setIsLoadingMore] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [hasMore, setHasMore] = useState(false);
	const [copiedId, setCopiedId] = useState<string | null>(null);

	const copyToClipboard = useCallback(async (text: string) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopiedId(text);
			setTimeout(() => setCopiedId(null), 2000);
		} catch {
			// Clipboard write failed, silently ignore
		}
	}, []);

	// Filters from URL query params
	const actionFilter = searchParams.get("action") ?? "";
	const resourceTypeFilter = searchParams.get("resourceType") ?? "";
	const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(
		null,
	);

	// Update URL query params
	const updateFilters = useCallback(
		(action: string, resourceType: string) => {
			const params = new URLSearchParams();
			if (action && action !== "all") {
				params.set("action", action);
			}
			if (resourceType && resourceType !== "all") {
				params.set("resourceType", resourceType);
			}
			const queryString = params.toString();
			router.push(queryString ? `?${queryString}` : "?", { scroll: false });
		},
		[router],
	);

	// Check if user can view audit logs (enterprise plan + owner/admin)
	const canViewAuditLogs =
		selectedOrganization?.plan === "enterprise" &&
		(currentUserRole === "owner" || currentUserRole === "admin");

	// Fetch filter options
	const fetchFilterOptions = async () => {
		try {
			const response = await fetchClient.GET(
				"/audit-logs/{organizationId}/filters",
				{
					params: { path: { organizationId } },
				},
			);

			if (response.data) {
				setFilterOptions(response.data as FilterOptions);
			}
		} catch {
			// Silently fail for filter options
		}
	};

	// Fetch audit logs with pagination
	const fetchAuditLogs = useCallback(
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
				if (actionFilter) {
					queryParams.action = actionFilter;
				}
				if (resourceTypeFilter) {
					queryParams.resourceType = resourceTypeFilter;
				}

				const response = await fetchClient.GET("/audit-logs/{organizationId}", {
					params: {
						path: { organizationId },
						query: queryParams,
					},
				});

				if (!response.data) {
					setError("Failed to load audit logs");
					return;
				}

				const data = response.data as AuditLogsResponse;

				if (isInitialLoad) {
					setAuditLogs(data.auditLogs);
				} else {
					setAuditLogs((prev) => [...prev, ...data.auditLogs]);
				}

				setNextCursor(data.pagination.nextCursor);
				setHasMore(data.pagination.hasMore);
				setError(null);
			} catch {
				setError("Failed to load audit logs");
			} finally {
				setIsLoading(false);
				setIsLoadingMore(false);
			}
		},
		[fetchClient, organizationId, actionFilter, resourceTypeFilter],
	);

	// Fetch filter options on mount
	useEffect(() => {
		if (canViewAuditLogs) {
			void fetchFilterOptions();
		}
	}, [canViewAuditLogs, organizationId]);

	// Fetch audit logs when filters change
	useEffect(() => {
		if (canViewAuditLogs) {
			setAuditLogs([]);
			setNextCursor(null);
			void fetchAuditLogs();
		} else {
			setIsLoading(false);
		}
	}, [canViewAuditLogs, fetchAuditLogs]);

	// If not enterprise plan, show contact sales
	if (selectedOrganization?.plan !== "enterprise") {
		return <ContactSalesCard />;
	}

	// Show loading while determining user role
	if (isLoadingTeam || !currentUserRole) {
		return (
			<div className="flex items-center justify-center py-12">
				<div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
			</div>
		);
	}

	// If not owner or admin, show access denied
	if (currentUserRole !== "owner" && currentUserRole !== "admin") {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Access Denied</CardTitle>
					<CardDescription>
						Only organization owners and admins can view audit logs.
					</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader>
					<CardTitle>Audit Logs</CardTitle>
					<CardDescription>
						View a complete history of all actions taken within your
						organization.
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
							<Select
								value={actionFilter || "all"}
								onValueChange={(value) => {
									updateFilters(value, resourceTypeFilter);
								}}
							>
								<SelectTrigger id="action-filter" className="w-[180px]">
									<SelectValue placeholder="All actions" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All actions</SelectItem>
									{filterOptions?.actions.map((action) => (
										<SelectItem key={action} value={action}>
											{formatAction(action)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="flex items-center gap-2">
							<label
								htmlFor="resource-filter"
								className="text-sm font-medium text-muted-foreground"
							>
								Resource:
							</label>
							<Select
								value={resourceTypeFilter || "all"}
								onValueChange={(value) => {
									updateFilters(actionFilter, value);
								}}
							>
								<SelectTrigger id="resource-filter" className="w-[180px]">
									<SelectValue placeholder="All resources" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All resources</SelectItem>
									{filterOptions?.resourceTypes.map((resourceType) => (
										<SelectItem key={resourceType} value={resourceType}>
											{formatResourceType(resourceType)}
										</SelectItem>
									))}
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

					{/* Audit logs table */}
					{!isLoading && !error && (
						<>
							{isMobile ? (
								// Mobile card view
								<div className="space-y-4">
									{auditLogs.map((log) => (
										<Card key={log.id}>
											<CardContent className="pt-4">
												<div className="flex flex-col gap-2">
													<div className="flex items-center justify-between">
														<Badge variant={getActionBadgeVariant(log.action)}>
															{formatAction(log.action)}
														</Badge>
														<span className="text-xs text-muted-foreground">
															{format(new Date(log.createdAt), "PPp")}
														</span>
													</div>
													<div className="text-sm">
														<span className="font-medium">
															{log.user?.email ?? log.userId}
														</span>
													</div>
													<div className="flex items-center gap-2 text-sm text-muted-foreground">
														<Badge variant="outline" className="text-xs">
															{formatResourceType(log.resourceType)}
														</Badge>
														{log.resourceId ? (
															<>
																<span className="font-mono text-xs">
																	{log.resourceId}
																</span>
																<button
																	type="button"
																	onClick={() =>
																		copyToClipboard(log.resourceId!)
																	}
																	className="p-1 rounded hover:bg-muted transition-colors"
																	title="Copy to clipboard"
																	aria-label={
																		copiedId === log.resourceId
																			? "Copied"
																			: "Copy resource ID to clipboard"
																	}
																>
																	{copiedId === log.resourceId ? (
																		<Check className="h-3 w-3 text-green-500" />
																	) : (
																		<Copy className="h-3 w-3 text-muted-foreground" />
																	)}
																</button>
															</>
														) : (
															<span className="font-mono text-xs">—</span>
														)}
													</div>
													{(log.metadata as { resourceName?: string })
														?.resourceName && (
														<div className="text-sm text-muted-foreground truncate">
															{
																(log.metadata as { resourceName?: string })
																	?.resourceName
															}
														</div>
													)}
												</div>
											</CardContent>
										</Card>
									))}
								</div>
							) : (
								// Desktop table view
								<div className="rounded-md border overflow-hidden">
									<table className="w-full">
										<thead className="bg-muted/50">
											<tr>
												<th className="p-4 text-left text-sm font-medium text-muted-foreground">
													Timestamp
												</th>
												<th className="p-4 text-left text-sm font-medium text-muted-foreground">
													User
												</th>
												<th className="p-4 text-left text-sm font-medium text-muted-foreground">
													Action
												</th>
												<th className="p-4 text-left text-sm font-medium text-muted-foreground">
													Resource
												</th>
												<th className="p-4 text-left text-sm font-medium text-muted-foreground">
													Resource ID
												</th>
												<th className="p-4 text-left text-sm font-medium text-muted-foreground">
													Details
												</th>
											</tr>
										</thead>
										<tbody className="divide-y">
											{auditLogs.map((log) => (
												<tr
													key={log.id}
													className="hover:bg-muted/25 transition-colors"
												>
													<td className="p-4 align-middle text-sm whitespace-nowrap">
														{format(new Date(log.createdAt), "PPp")}
													</td>
													<td className="p-4 align-middle">
														<div className="flex flex-col">
															<span className="text-sm font-medium">
																{log.user?.name ?? "—"}
															</span>
															<span className="text-xs text-muted-foreground">
																{log.user?.email ?? log.userId}
															</span>
														</div>
													</td>
													<td className="p-4 align-middle">
														<Badge variant={getActionBadgeVariant(log.action)}>
															{formatAction(log.action)}
														</Badge>
													</td>
													<td className="p-4 align-middle whitespace-nowrap">
														<Badge variant="outline" className="text-xs">
															{formatResourceType(log.resourceType)}
														</Badge>
													</td>
													<td className="p-4 align-middle">
														{log.resourceId ? (
															<div className="flex items-center gap-2">
																<span className="text-sm font-mono text-muted-foreground">
																	{log.resourceId}
																</span>
																<button
																	type="button"
																	onClick={() =>
																		copyToClipboard(log.resourceId!)
																	}
																	className="p-1 rounded hover:bg-muted transition-colors"
																	title="Copy to clipboard"
																	aria-label={
																		copiedId === log.resourceId
																			? "Copied"
																			: "Copy resource ID to clipboard"
																	}
																>
																	{copiedId === log.resourceId ? (
																		<Check className="h-3.5 w-3.5 text-green-500" />
																	) : (
																		<Copy className="h-3.5 w-3.5 text-muted-foreground" />
																	)}
																</button>
															</div>
														) : (
															<span className="text-sm text-muted-foreground">
																—
															</span>
														)}
													</td>
													<td className="p-4 align-middle text-sm text-muted-foreground max-w-xs truncate">
														{(log.metadata as { resourceName?: string })
															?.resourceName ?? "—"}
													</td>
												</tr>
											))}
											{auditLogs.length === 0 && (
												<tr>
													<td
														colSpan={6}
														className="p-8 text-center text-muted-foreground"
													>
														No audit logs found
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
										onClick={() => fetchAuditLogs(nextCursor ?? undefined)}
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
