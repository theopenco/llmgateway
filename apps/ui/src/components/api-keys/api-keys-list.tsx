import { useQueryClient } from "@tanstack/react-query";
import {
	BarChart3Icon,
	EditIcon,
	KeyIcon,
	MoreHorizontal,
	PlusIcon,
	Shield,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/lib/components/alert-dialog";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/lib/components/dropdown-menu";
import { StatusBadge } from "@/lib/components/status-badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/lib/components/table";
import { Tabs, TabsList, TabsTrigger } from "@/lib/components/tabs";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/lib/components/tooltip";
import { toast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";
import { extractOrgAndProjectFromPath } from "@/lib/navigation-utils";

import {
	formatCurrentPeriodUsageSummary,
	formatCurrencyAmount,
	formatPeriodLimitSummary,
	type ApiKeyLimitPayload,
} from "./api-key-limit-fields";
import { ApiKeyLimitsDialog } from "./api-key-limits-dialog";
import { CreateApiKeyDialog } from "./create-api-key-dialog";

import type { ApiKey, Project } from "@/lib/types";
import type { Route } from "next";

interface ApiKeysListProps {
	selectedProject: Project | null;
	initialData: ApiKey[];
}

type StatusFilter = "all" | "active" | "inactive";
type CreatorFilter = "mine" | "all";

export function ApiKeysList({
	selectedProject,
	initialData,
}: ApiKeysListProps) {
	const queryClient = useQueryClient();
	const api = useApi();
	const pathname = usePathname();
	const { orgId, projectId } = useMemo(
		() => extractOrgAndProjectFromPath(pathname),
		[pathname],
	);
	const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
	const [creatorFilter, setCreatorFilter] = useState<CreatorFilter>("all");

	const getIamRulesUrl = (keyId: string) =>
		`/dashboard/${orgId}/${projectId}/api-keys/${keyId}/iam` as Route;

	const getStatisticsUrl = (keyId: string) =>
		`/dashboard/${orgId}/${projectId}/usage?apiKeyId=${keyId}` as Route;

	// All hooks must be called before any conditional returns
	const { data, isLoading, error } = api.useQuery(
		"get",
		"/keys/api",
		{
			params: {
				query: {
					projectId: selectedProject?.id ?? "",
					filter: creatorFilter,
				},
			},
		},
		{
			enabled: !!selectedProject?.id,
			staleTime: 5 * 60 * 1000, // 5 minutes
			refetchOnWindowFocus: false,
			refetchOnMount: false,
			refetchInterval: false,
			// Only use initialData when filter is "all" (matches the SSR data)
			...(creatorFilter === "all" && {
				initialData: {
					apiKeys: initialData.map((key) => ({
						...key,
						maskedToken: key.maskedToken,
					})),
					userRole: "owner" as const,
				},
			}),
		},
	);

	const { mutate: deleteMutation } = api.useMutation(
		"delete",
		"/keys/api/{id}",
	);
	const { mutate: toggleKeyStatus } = api.useMutation(
		"patch",
		"/keys/api/{id}",
	);

	const updateKeyUsageLimitMutation = api.useMutation(
		"patch",
		"/keys/api/limit/{id}",
	);

	const allKeys = data?.apiKeys.filter((key) => key.status !== "deleted") ?? [];
	const activeKeys = allKeys.filter((key) => key.status === "active");
	const inactiveKeys = allKeys.filter((key) => key.status === "inactive");
	const planLimits = data?.planLimits;

	const filteredKeys = (() => {
		switch (statusFilter) {
			case "active":
				return activeKeys;
			case "inactive":
				return inactiveKeys;
			case "all":
			default:
				return allKeys;
		}
	})();

	// Auto-switch to a tab with content if current tab becomes empty
	useEffect(() => {
		if (filteredKeys.length === 0 && allKeys.length > 0) {
			if (statusFilter === "active" && inactiveKeys.length > 0) {
				setStatusFilter("inactive");
			} else if (statusFilter === "inactive" && activeKeys.length > 0) {
				setStatusFilter("active");
			} else if (statusFilter !== "all") {
				setStatusFilter("all");
			}
		}
	}, [
		filteredKeys.length,
		allKeys.length,
		activeKeys.length,
		inactiveKeys.length,
		statusFilter,
	]);

	// Show message if no project is selected
	if (!selectedProject) {
		return (
			<div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-center">
				<div className="mb-4">
					<KeyIcon className="h-10 w-10 text-gray-500" />
				</div>
				<p className="text-gray-400 mb-6">
					Please select a project to view API keys.
				</p>
			</div>
		);
	}

	// Handle loading state
	if (isLoading) {
		return (
			<div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-center">
				<div className="mb-4">
					<KeyIcon className="h-10 w-10 text-gray-500" />
				</div>
				<p className="text-gray-400 mb-6">Loading API keys...</p>
			</div>
		);
	}

	// Handle error state
	if (error) {
		return (
			<div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-center">
				<div className="mb-4">
					<KeyIcon className="h-10 w-10 text-gray-500" />
				</div>
				<p className="text-gray-400 mb-6">
					Failed to load API keys. Please try again.
				</p>
			</div>
		);
	}

	const deleteKey = (id: string) => {
		deleteMutation(
			{
				params: {
					path: { id },
				},
			},
			{
				onSuccess: () => {
					const queryKey = api.queryOptions("get", "/keys/api", {
						params: {
							query: { projectId: selectedProject.id },
						},
					}).queryKey;

					void queryClient.invalidateQueries({ queryKey });

					toast({ title: "API key deleted successfully." });
				},
			},
		);
	};

	const toggleStatus = (
		id: string,
		currentStatus: "active" | "inactive" | "deleted" | null,
	) => {
		const newStatus = currentStatus === "active" ? "inactive" : "active";

		toggleKeyStatus(
			{
				params: {
					path: { id },
				},
				body: {
					status: newStatus,
				},
			},
			{
				onSuccess: () => {
					const queryKey = api.queryOptions("get", "/keys/api", {
						params: {
							query: { projectId: selectedProject.id },
						},
					}).queryKey;

					void queryClient.invalidateQueries({ queryKey });

					toast({
						title: "API Key Status Updated",
						description: "The API key status has been updated.",
					});
				},
			},
		);
	};

	const updateKeyUsageLimit = async (
		id: string,
		payload: ApiKeyLimitPayload,
	) => {
		try {
			await updateKeyUsageLimitMutation.mutateAsync(
				{
					params: {
						path: { id },
					},
					body: payload,
				},
				{
					onSuccess: () => {
						const queryKey = api.queryOptions("get", "/keys/api", {
							params: {
								query: { projectId: selectedProject.id },
							},
						}).queryKey;

						void queryClient.invalidateQueries({ queryKey });

						toast({
							title: "API Key Limits Updated",
							description: "The API key limits have been updated.",
						});
					},
				},
			);
		} catch (error) {
			toast({
				title: "Failed to update API key limits.",
				variant: "destructive",
			});
			throw error;
		}
	};

	const renderCurrentPeriodUsage = (key: ApiKey) => {
		const summary = formatCurrentPeriodUsageSummary(key);

		return (
			<div className="space-y-1">
				<div
					className={
						summary.windowLabel
							? "font-mono text-xs"
							: "text-muted-foreground text-xs"
					}
				>
					{summary.summary}
				</div>
				{summary.windowLabel && (
					<div className="text-muted-foreground text-xs">
						Every {summary.windowLabel}
					</div>
				)}
				{summary.resetLabel && (
					<div className="text-muted-foreground text-xs">
						Resets {summary.resetLabel}
					</div>
				)}
			</div>
		);
	};

	const renderLimitSummary = (key: ApiKey) => (
		<div className="text-left">
			<div className="font-mono text-xs">
				{key.usageLimit
					? formatCurrencyAmount(key.usageLimit)
					: "No all-time limit"}
			</div>
			<div className="text-muted-foreground text-xs">
				{formatPeriodLimitSummary(key)}
			</div>
		</div>
	);

	if (allKeys.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-center">
				<div className="mb-4">
					<KeyIcon className="h-10 w-10 text-gray-500" />
				</div>
				<p className="text-gray-400 mb-6">No API keys have been created yet.</p>
				<CreateApiKeyDialog
					selectedProject={selectedProject}
					disabled={
						planLimits ? planLimits.currentCount >= planLimits.maxKeys : false
					}
					disabledMessage={
						planLimits
							? `${planLimits.plan === "pro" ? "Pro" : "Free"} plan allows maximum ${planLimits.maxKeys} API keys per project`
							: undefined
					}
				>
					<Button
						type="button"
						disabled={
							planLimits ? planLimits.currentCount >= planLimits.maxKeys : false
						}
						className="cursor-pointer flex items-center gap-2 bg-white text-black px-4 py-2 rounded-md hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
					>
						<PlusIcon className="h-5 w-5" />
						Create API Key
					</Button>
				</CreateApiKeyDialog>
			</div>
		);
	}

	return (
		<>
			{/* Filter Tabs */}
			<div className="mb-6 flex flex-col gap-4">
				{/* Creator Filter */}
				<Tabs
					value={creatorFilter}
					onValueChange={(value) => setCreatorFilter(value as CreatorFilter)}
				>
					<TabsList className="flex space-x-2 w-full md:w-fit">
						<TabsTrigger value="all">All Keys</TabsTrigger>
						<TabsTrigger value="mine">My Keys</TabsTrigger>
					</TabsList>
				</Tabs>

				{/* Status Filter Tabs */}
				<Tabs
					value={statusFilter}
					onValueChange={(value) => setStatusFilter(value as StatusFilter)}
				>
					<TabsList className="flex space-x-2 w-full md:w-fit">
						<TabsTrigger value="all">
							All{" "}
							<Badge
								variant={statusFilter === "all" ? "default" : "outline"}
								className="text-xs"
							>
								{allKeys.length}
							</Badge>
						</TabsTrigger>
						{activeKeys.length > 0 && (
							<TabsTrigger value="active">
								Active{" "}
								<Badge
									variant={statusFilter === "active" ? "default" : "outline"}
									className="text-xs"
								>
									{activeKeys.length}
								</Badge>
							</TabsTrigger>
						)}
						{inactiveKeys.length > 0 && (
							<TabsTrigger value="inactive">
								Inactive{" "}
								<Badge
									variant={statusFilter === "inactive" ? "default" : "outline"}
									className="text-xs"
								>
									{inactiveKeys.length}
								</Badge>
							</TabsTrigger>
						)}
					</TabsList>
				</Tabs>
			</div>

			{/* Plan Limits Display */}
			{planLimits && (
				<div className="mb-4 rounded-lg border bg-muted/30 p-4">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-4">
							<div className="text-sm text-muted-foreground">
								<span className="font-medium">API Keys:</span>{" "}
								{planLimits.currentCount} of {planLimits.maxKeys} used
							</div>
						</div>
						{planLimits.currentCount >= planLimits.maxKeys && (
							<div className="text-xs text-amber-600 font-medium">
								Limit reached — contact us at contact@llmgateway.io to unlock
								more
							</div>
						)}
					</div>
				</div>
			)}

			{/* Desktop Table */}
			<div className="hidden md:block overflow-x-auto">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							<TableHead className="w-40">API Key</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>Created</TableHead>
							<TableHead>Created By</TableHead>
							<TableHead>Usage</TableHead>
							<TableHead>Current Period</TableHead>
							<TableHead>Limits</TableHead>
							<TableHead>IAM Rules</TableHead>
							<TableHead className="text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{filteredKeys.map((key) => (
							<TableRow
								key={key.id}
								className="hover:bg-muted/30 transition-colors"
							>
								<TableCell className="font-medium">
									<span className="text-sm font-medium">{key.description}</span>
								</TableCell>
								<TableCell className="min-w-40 max-w-40">
									<div className="flex items-center space-x-2">
										<span className="font-mono text-xs truncate">
											{key.maskedToken}
										</span>
									</div>
								</TableCell>
								<TableCell>
									<StatusBadge status={key.status} variant="detailed" />
								</TableCell>
								<TableCell>
									<Tooltip>
										<TooltipTrigger asChild>
											<span className="text-muted-foreground cursor-help border-b border-dotted border-muted-foreground/50 hover:border-muted-foreground">
												{Intl.DateTimeFormat(undefined, {
													month: "short",
													day: "numeric",
													year: "numeric",
												}).format(new Date(key.createdAt))}
											</span>
										</TooltipTrigger>
										<TooltipContent>
											<p className="max-w-xs text-xs whitespace-nowrap">
												{Intl.DateTimeFormat(undefined, {
													month: "short",
													day: "numeric",
													year: "numeric",
													hour: "2-digit",
													minute: "2-digit",
												}).format(new Date(key.createdAt))}
											</p>
										</TooltipContent>
									</Tooltip>
								</TableCell>
								<TableCell>
									<Tooltip>
										<TooltipTrigger asChild>
											<span className="text-muted-foreground cursor-help">
												{key.creator?.name ?? key.creator?.email ?? "Unknown"}
											</span>
										</TooltipTrigger>
										<TooltipContent>
											<p className="max-w-xs text-xs">
												{key.creator?.email ?? "No email available"}
											</p>
										</TooltipContent>
									</Tooltip>
								</TableCell>
								<TableCell>{formatCurrencyAmount(key.usage)}</TableCell>
								<TableCell>{renderCurrentPeriodUsage(key)}</TableCell>
								<TableCell>
									<ApiKeyLimitsDialog
										apiKey={key}
										onSubmit={(payload) => updateKeyUsageLimit(key.id, payload)}
									>
										<Button
											variant="outline"
											size="sm"
											className="min-w-48 flex items-center justify-between gap-3"
										>
											{renderLimitSummary(key)}
											<EditIcon />
										</Button>
									</ApiKeyLimitsDialog>
								</TableCell>
								<TableCell>
									{key.iamRules && key.iamRules.length > 0 ? (
										<Button
											variant="outline"
											size="sm"
											className="text-xs"
											asChild
										>
											<Link href={getIamRulesUrl(key.id)}>
												{
													key.iamRules.filter(
														(rule) => rule.status === "active",
													).length
												}{" "}
												rule
												{key.iamRules.filter((rule) => rule.status === "active")
													.length !== 1
													? "s"
													: ""}
											</Link>
										</Button>
									) : (
										<Button
											variant="ghost"
											size="sm"
											className="text-xs text-muted-foreground"
											asChild
										>
											<Link href={getIamRulesUrl(key.id)}>No rules</Link>
										</Button>
									)}
								</TableCell>
								<TableCell className="text-right">
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<Button variant="ghost" size="icon" className="h-8 w-8">
												<MoreHorizontal className="h-4 w-4" />
												<span className="sr-only">Open menu</span>
											</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent align="end">
											<DropdownMenuLabel>Actions</DropdownMenuLabel>
											<DropdownMenuItem asChild>
												<Link href={getStatisticsUrl(key.id)} prefetch={true}>
													<BarChart3Icon className="mr-2 h-4 w-4" />
													View Statistics
												</Link>
											</DropdownMenuItem>
											<DropdownMenuItem asChild>
												<Link href={getIamRulesUrl(key.id)}>
													<Shield className="mr-2 h-4 w-4" />
													Manage IAM Rules
												</Link>
											</DropdownMenuItem>
											{key.description !== "Auto-generated playground key" && (
												<>
													<DropdownMenuSeparator />
													<DropdownMenuItem
														onClick={() => toggleStatus(key.id, key.status)}
													>
														{key.status === "active"
															? "Deactivate"
															: "Activate"}{" "}
														Key
													</DropdownMenuItem>
													<DropdownMenuSeparator />
													<AlertDialog>
														<AlertDialogTrigger asChild>
															<DropdownMenuItem
																onSelect={(e) => e.preventDefault()}
																className="text-destructive focus:text-destructive"
															>
																Delete
															</DropdownMenuItem>
														</AlertDialogTrigger>
														<AlertDialogContent>
															<AlertDialogHeader>
																<AlertDialogTitle>
																	Are you absolutely sure?
																</AlertDialogTitle>
																<AlertDialogDescription>
																	This action cannot be undone. This will
																	permanently delete the API key and it will no
																	longer be able to access your account.
																</AlertDialogDescription>
															</AlertDialogHeader>
															<AlertDialogFooter>
																<AlertDialogCancel>Cancel</AlertDialogCancel>
																<AlertDialogAction
																	onClick={() => deleteKey(key.id)}
																>
																	Delete
																</AlertDialogAction>
															</AlertDialogFooter>
														</AlertDialogContent>
													</AlertDialog>
												</>
											)}
										</DropdownMenuContent>
									</DropdownMenu>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>

			{/* Mobile Cards */}
			<div className="md:hidden space-y-3">
				{filteredKeys.map((key) => (
					<div key={key.id} className="border rounded-lg p-3 space-y-3">
						<div className="flex items-start justify-between">
							<div className="flex-1 min-w-0">
								<div className="flex items-center gap-2">
									<h3 className="font-medium text-sm">{key.description}</h3>
									<StatusBadge status={key.status} />
								</div>
								<div className="flex items-center gap-2 mt-1">
									<span className="text-xs text-muted-foreground">
										{Intl.DateTimeFormat(undefined, {
											month: "short",
											day: "numeric",
											year: "numeric",
											hour: "2-digit",
											minute: "2-digit",
										}).format(new Date(key.createdAt))}
									</span>
								</div>
							</div>
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button variant="ghost" size="sm" className="h-8 w-8 p-0">
										<MoreHorizontal className="h-4 w-4" />
										<span className="sr-only">Open menu</span>
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									<DropdownMenuLabel>Actions</DropdownMenuLabel>
									<DropdownMenuItem asChild>
										<Link href={getStatisticsUrl(key.id)} prefetch={true}>
											<BarChart3Icon className="mr-2 h-4 w-4" />
											View Statistics
										</Link>
									</DropdownMenuItem>
									<DropdownMenuItem asChild>
										<Link href={getIamRulesUrl(key.id)}>
											<Shield className="mr-2 h-4 w-4" />
											Manage IAM Rules
										</Link>
									</DropdownMenuItem>
									{key.description !== "Auto-generated playground key" && (
										<>
											<DropdownMenuSeparator />
											<DropdownMenuItem
												onClick={() => toggleStatus(key.id, key.status)}
											>
												{key.status === "active" ? "Deactivate" : "Activate"}{" "}
												Key
											</DropdownMenuItem>
											<DropdownMenuSeparator />
											<AlertDialog>
												<AlertDialogTrigger asChild>
													<DropdownMenuItem
														onSelect={(e) => e.preventDefault()}
														className="text-destructive focus:text-destructive"
													>
														Delete
													</DropdownMenuItem>
												</AlertDialogTrigger>
												<AlertDialogContent>
													<AlertDialogHeader>
														<AlertDialogTitle>
															Are you absolutely sure?
														</AlertDialogTitle>
														<AlertDialogDescription>
															This action cannot be undone. This will
															permanently delete the API key and it will no
															longer be able to access your account.
														</AlertDialogDescription>
													</AlertDialogHeader>
													<AlertDialogFooter>
														<AlertDialogCancel>Cancel</AlertDialogCancel>
														<AlertDialogAction
															onClick={() => deleteKey(key.id)}
														>
															Delete
														</AlertDialogAction>
													</AlertDialogFooter>
												</AlertDialogContent>
											</AlertDialog>
										</>
									)}
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
						<div className="pt-2 border-t">
							<div className="text-xs text-muted-foreground mb-1">API Key</div>
							<div className="font-mono text-xs break-all">
								{key.maskedToken}
							</div>
						</div>
						<div className="pt-2 border-t grid gap-3 md:grid-cols-3">
							<div className="py-1">
								<div className="text-xs text-muted-foreground mb-1">Usage</div>
								<div className="font-mono text-xs break-all">
									{formatCurrencyAmount(key.usage)}
								</div>
							</div>
							<div className="py-1">
								<div className="text-xs text-muted-foreground mb-1">
									Current Period
								</div>
								{renderCurrentPeriodUsage(key)}
							</div>
							<div>
								<ApiKeyLimitsDialog
									apiKey={key}
									onSubmit={(payload) => updateKeyUsageLimit(key.id, payload)}
								>
									<Button
										variant="outline"
										size="sm"
										className="min-w-32 flex justify-between h-full py-2"
									>
										<div className="text-left">
											<div className="text-xs text-muted-foreground mb-1">
												Limits
											</div>
											{renderLimitSummary(key)}
										</div>
										<EditIcon />
									</Button>
								</ApiKeyLimitsDialog>
							</div>
						</div>
						<div className="pt-2 border-t">
							<div className="text-xs text-muted-foreground mb-1">
								IAM Rules
							</div>
							<div className="flex items-center">
								{key.iamRules && key.iamRules.length > 0 ? (
									<Button
										variant="outline"
										size="sm"
										className="text-xs h-7"
										asChild
									>
										<Link href={getIamRulesUrl(key.id)}>
											{
												key.iamRules.filter((rule) => rule.status === "active")
													.length
											}{" "}
											active rule
											{key.iamRules.filter((rule) => rule.status === "active")
												.length !== 1
												? "s"
												: ""}
										</Link>
									</Button>
								) : (
									<Button
										variant="ghost"
										size="sm"
										className="text-xs text-muted-foreground h-7"
										asChild
									>
										<Link href={getIamRulesUrl(key.id)}>
											No rules configured
										</Link>
									</Button>
								)}
							</div>
						</div>
						<div className="pt-2 border-t">
							<div className="text-xs text-muted-foreground mb-1">
								Created By
							</div>
							<div className="text-sm">
								{key.creator?.name ?? key.creator?.email ?? "Unknown"}
							</div>
						</div>
					</div>
				))}
			</div>
		</>
	);
}
