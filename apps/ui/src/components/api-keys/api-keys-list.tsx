"use client";

import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
	BarChart3Icon,
	ChevronLeftIcon,
	ChevronRightIcon,
	EditIcon,
	KeyIcon,
	MoreHorizontal,
	PencilIcon,
	PlusIcon,
	PowerIcon,
	RefreshCwIcon,
	SearchIcon,
	Shield,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { getApiErrorMessage } from "@/lib/api-error";
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
import { Input } from "@/lib/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import { SelectionCheckbox } from "@/lib/components/selection-checkbox";
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
import { cn } from "@/lib/utils";

import { Time } from "@llmgateway/shared";
import { formatNumber } from "@llmgateway/shared/number-format";

import {
	ApiKeyInsightsSummary,
	ApiKeyUnusedBadge,
} from "./api-key-insight-indicators";
import { getApiKeyUnusedInsight } from "./api-key-insights";
import {
	formatCurrentPeriodUsageSummary,
	formatCurrencyAmount,
	formatPeriodLimitSummary,
	type ApiKeyLimitPayload,
} from "./api-key-limit-fields";
import {
	ApiKeyLimitBadge,
	ApiKeyLimitMeter,
	apiKeyLimitTextTone,
} from "./api-key-limit-indicators";
import { getApiKeyLimitStatus } from "./api-key-limit-status";
import { ApiKeyLimitsDialog } from "./api-key-limits-dialog";
import {
	summarizeApiKeySelection,
	toggleKeySelection,
	togglePageSelection,
} from "./api-key-selection";
import { formatApiKeyExpiry } from "./api-key-ttl-fields";
import {
	apiKeyUsagePeriodLabel,
	parseApiKeyUsagePeriod,
} from "./api-key-usage-period";
import { ApiKeyUsagePeriodSelect } from "./api-key-usage-period-select";
import {
	ApiKeysBulkActionBar,
	ApiKeysSelectionBanner,
} from "./api-keys-bulk-actions";
import { CreateApiKeyDialog } from "./create-api-key-dialog";
import { ReactivateApiKeyDialog } from "./reactivate-api-key-dialog";
import { RenameApiKeyDialog } from "./rename-api-key-dialog";
import { RollApiKeyDialog } from "./roll-api-key-dialog";

import type { ApiKeyUnusedInsight } from "./api-key-insights";
import type { ApiKeyLimitStatus } from "./api-key-limit-status";
import type { ApiKeyUsagePeriod } from "./api-key-usage-period";
import type { ApiKey, Project } from "@/lib/types";
import type { Route } from "next";
import type { ReactNode } from "react";

/** Which keys a list shows: one project, or every project of an organization. */
export type ApiKeysScope =
	| { type: "project"; project: Project | null }
	| { type: "organization"; organizationId: string; projects: Project[] };

interface ApiKeysListProps {
	scope: ApiKeysScope;
	initialData: ApiKey[];
	/** Period the SSR `initialData` was fetched for. */
	initialPeriod: ApiKeyUsagePeriod;
}

type StatusFilter = "all" | "active" | "inactive";
type CreatorFilter = "mine" | "all";
type UsageFilter = "all" | "approaching" | "reached" | "unused";

export const API_KEYS_PAGE_SIZE = 50;

const ALL_PROJECTS = "__all__";

/** Query params of GET /keys/api for a scope, shared with the page header. */
export function apiKeysScopeQuery(scope: ApiKeysScope) {
	return scope.type === "project"
		? { projectId: scope.project?.id ?? "" }
		: { organizationId: scope.organizationId };
}

export function isApiKeysScopeReady(scope: ApiKeysScope): boolean {
	return scope.type === "project"
		? !!scope.project?.id
		: !!scope.organizationId;
}

export function formatPlanLimitMessage(planLimits: {
	plan: "free" | "pro" | "enterprise";
	maxKeys: number;
}): string {
	const plan =
		planLimits.plan === "enterprise"
			? "Enterprise"
			: planLimits.plan === "pro"
				? "Pro"
				: "Free";
	return `${plan} plan allows maximum ${planLimits.maxKeys} API keys per organization`;
}

function activeRuleCount(key: ApiKey): number {
	return key.iamRules?.filter((rule) => rule.status === "active").length ?? 0;
}

function renderLastUsed(key: ApiKey) {
	if (!key.lastUsedAt) {
		return <span className="text-muted-foreground text-xs">Never</span>;
	}

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span className="text-muted-foreground cursor-help text-xs">
					{formatDistanceToNow(new Date(key.lastUsedAt), { addSuffix: true })}
				</span>
			</TooltipTrigger>
			<TooltipContent>
				<p className="max-w-xs text-xs whitespace-nowrap">
					Last request in the hour starting{" "}
					<Time date={key.lastUsedAt} format="monthDayYearHourMinuteZone" />
				</p>
			</TooltipContent>
		</Tooltip>
	);
}

function ManagedPlaygroundTableRow({
	apiKey,
	statisticsUrl,
	projectName,
	usage,
	lastUsed,
}: {
	apiKey: ApiKey;
	statisticsUrl: Route;
	projectName?: string;
	usage: ReactNode;
	lastUsed: ReactNode;
}) {
	return (
		<TableRow className="hover:bg-muted/30 transition-colors">
			<TableCell />
			<TableCell>
				<div className="flex items-center gap-2">
					<span className="font-medium">Playground</span>
					<Badge variant="outline">Managed</Badge>
				</div>
			</TableCell>
			{projectName !== undefined && (
				<TableCell className="text-muted-foreground">{projectName}</TableCell>
			)}
			<TableCell className="min-w-40 max-w-40">
				<span className="font-mono text-xs truncate">{apiKey.maskedToken}</span>
			</TableCell>
			<TableCell>
				<StatusBadge status={apiKey.status} variant="detailed" />
			</TableCell>
			<TableCell>
				<Time date={apiKey.createdAt} format="monthDayYear" />
			</TableCell>
			<TableCell>{lastUsed}</TableCell>
			<TableCell className="text-muted-foreground">
				{apiKey.creator?.name ?? apiKey.creator?.email ?? "Unknown"}
			</TableCell>
			<TableCell>{usage}</TableCell>
			<TableCell className="text-muted-foreground">
				{formatCurrentPeriodUsageSummary(apiKey).summary}
			</TableCell>
			<TableCell className="text-muted-foreground">Not applicable</TableCell>
			<TableCell className="text-muted-foreground">Not applicable</TableCell>
			<TableCell className="sticky right-0 bg-card text-center">
				<Button variant="ghost" size="icon" className="h-8 w-8" asChild>
					<Link href={statisticsUrl} prefetch={true}>
						<BarChart3Icon className="h-4 w-4" />
						<span className="sr-only">View Statistics</span>
					</Link>
				</Button>
			</TableCell>
		</TableRow>
	);
}

function ManagedPlaygroundCard({
	apiKey,
	statisticsUrl,
	usage,
}: {
	apiKey: ApiKey;
	statisticsUrl: Route;
	usage: ReactNode;
}) {
	return (
		<div className="border rounded-lg p-3 space-y-3">
			<div className="flex items-start justify-between gap-3">
				<div className="flex items-center gap-2">
					<h3 className="font-medium text-sm">Playground</h3>
					<Badge variant="outline">Managed</Badge>
					<StatusBadge status={apiKey.status} />
				</div>
				<Button variant="ghost" size="sm" asChild>
					<Link href={statisticsUrl} prefetch={true}>
						<BarChart3Icon className="mr-2 h-4 w-4" />
						Statistics
					</Link>
				</Button>
			</div>
			<div className="pt-2 border-t grid grid-cols-2 gap-3">
				<div>
					<div className="text-xs text-muted-foreground mb-1">API Key</div>
					<div className="font-mono text-xs break-all">
						{apiKey.maskedToken}
					</div>
				</div>
				<div>
					<div className="text-xs text-muted-foreground mb-1">Usage</div>
					{usage}
				</div>
			</div>
		</div>
	);
}

export function ApiKeysList({
	scope,
	initialData,
	initialPeriod,
}: ApiKeysListProps) {
	const queryClient = useQueryClient();
	const api = useApi();
	const pathname = usePathname();
	const router = useRouter();
	const searchParams = useSearchParams();
	const { selectedOrganization } = useDashboardNavigation();
	// Developers only ever see their own keys, so the All/Mine selector is hidden.
	const isDeveloper = selectedOrganization?.role === "developer";
	const { orgId } = useMemo(
		() => extractOrgAndProjectFromPath(pathname),
		[pathname],
	);
	const isOrgScope = scope.type === "organization";
	const period = parseApiKeyUsagePeriod(searchParams.get("period"));
	const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
	const [creatorFilter, setCreatorFilter] = useState<CreatorFilter>("all");
	const [usageFilter, setUsageFilter] = useState<UsageFilter>("all");
	const [projectFilter, setProjectFilter] = useState<string>(ALL_PROJECTS);
	const [search, setSearch] = useState("");
	const [page, setPage] = useState(0);
	const [selected, setSelected] = useState<Set<string>>(() => new Set());
	const [reactivateKey, setReactivateKey] = useState<ApiKey | null>(null);
	const [rollKey, setRollKey] = useState<ApiKey | null>(null);
	const [renameKey, setRenameKey] = useState<ApiKey | null>(null);
	const [now] = useState(() => new Date());

	const projectNames = useMemo(
		() =>
			new Map(
				(scope.type === "organization" ? scope.projects : []).map((project) => [
					project.id,
					project.name,
				]),
			),
		[scope],
	);

	const getIamRulesUrl = (key: ApiKey) =>
		`/dashboard/${orgId}/${key.projectId}/api-keys/${key.id}/iam` as Route;

	const getStatisticsUrl = (key: ApiKey) =>
		`/dashboard/${orgId}/${key.projectId}/api-keys/${key.id}` as Route;

	// Every view change starts a fresh selection on the first page, so a bulk
	// action never touches keys the user can no longer see.
	const resetView = () => {
		setSelected(new Set());
		setPage(0);
	};

	const setPeriod = (next: ApiKeyUsagePeriod) => {
		const params = new URLSearchParams(searchParams.toString());
		if (next === "all") {
			params.delete("period");
		} else {
			params.set("period", next);
		}
		const query = params.toString();
		resetView();
		router.replace(`${pathname}${query ? `?${query}` : ""}` as Route, {
			scroll: false,
		});
	};

	// All hooks must be called before any conditional returns
	const { data, isLoading, error } = api.useQuery(
		"get",
		"/keys/api",
		{
			params: {
				query: {
					...apiKeysScopeQuery(scope),
					filter: creatorFilter,
					period,
				},
			},
		},
		{
			enabled: isApiKeysScopeReady(scope),
			staleTime: 5 * 60 * 1000, // 5 minutes
			refetchOnWindowFocus: false,
			refetchInterval: false,
			// Only use initialData for the query the server rendered
			...(creatorFilter === "all" &&
				period === initialPeriod && {
					initialData: {
						apiKeys: initialData.map((key) => ({
							...key,
							ownerBudget: key.ownerBudget ?? null,
							periodUsage: key.periodUsage ?? null,
							periodRequestCount: key.periodRequestCount ?? null,
							lastUsedAt: key.lastUsedAt ?? null,
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
	const {
		mutate: toggleKeyStatus,
		mutateAsync: toggleKeyStatusAsync,
		isPending: isTogglePending,
	} = api.useMutation("patch", "/keys/api/{id}");

	const updateKeyUsageLimitMutation = api.useMutation(
		"patch",
		"/keys/api/limit/{id}",
	);

	const { mutateAsync: rollKeyAsync, isPending: isRollPending } =
		api.useMutation("post", "/keys/api/{id}/roll");

	const { mutateAsync: renameKeyAsync, isPending: isRenamePending } =
		api.useMutation("patch", "/keys/api/{id}");

	const allKeys = useMemo(
		() => data?.apiKeys.filter((key) => key.status !== "deleted") ?? [],
		[data],
	);
	const planLimits = data?.planLimits;

	const limitStatuses = useMemo(
		() =>
			new Map<string, ApiKeyLimitStatus>(
				allKeys.map((key) => [key.id, getApiKeyLimitStatus(key)]),
			),
		[allKeys],
	);
	const limitStatusOf = (key: ApiKey): ApiKeyLimitStatus =>
		limitStatuses.get(key.id) ?? { period: null, state: null, total: null };

	const insights = useMemo(
		() =>
			new Map<string, ApiKeyUnusedInsight | null>(
				allKeys.map((key) => [key.id, getApiKeyUnusedInsight(key, now)]),
			),
		[allKeys, now],
	);
	const insightOf = (key: ApiKey) => insights.get(key.id) ?? null;

	const normalizedSearch = search.trim().toLowerCase();
	const scopedKeys = allKeys.filter(
		(key) =>
			(projectFilter === ALL_PROJECTS || key.projectId === projectFilter) &&
			(!normalizedSearch ||
				key.description.toLowerCase().includes(normalizedSearch) ||
				key.maskedToken.toLowerCase().includes(normalizedSearch)),
	);
	const activeKeys = scopedKeys.filter((key) => key.status === "active");
	const inactiveKeys = scopedKeys.filter((key) => key.status === "inactive");
	const unusedKeys = scopedKeys.filter((key) => insightOf(key) !== null);
	const criticalUnusedCount = unusedKeys.filter(
		(key) => insightOf(key)?.level === "critical",
	).length;

	const statusFilteredKeys =
		statusFilter === "active"
			? activeKeys
			: statusFilter === "inactive"
				? inactiveKeys
				: scopedKeys;

	const approachingKeys = statusFilteredKeys.filter(
		(key) => limitStatusOf(key).state === "approaching",
	);
	const reachedKeys = statusFilteredKeys.filter(
		(key) => limitStatusOf(key).state === "reached",
	);
	const unusedInStatus = statusFilteredKeys.filter(
		(key) => insightOf(key) !== null,
	);

	const filteredKeys =
		usageFilter === "approaching"
			? approachingKeys
			: usageFilter === "reached"
				? reachedKeys
				: usageFilter === "unused"
					? unusedInStatus
					: statusFilteredKeys;

	const pageCount = Math.max(
		1,
		Math.ceil(filteredKeys.length / API_KEYS_PAGE_SIZE),
	);
	const currentPage = Math.min(page, pageCount - 1);
	const pageStart = currentPage * API_KEYS_PAGE_SIZE;
	const pageKeys = filteredKeys.slice(
		pageStart,
		pageStart + API_KEYS_PAGE_SIZE,
	);
	const selectableIds = (keys: ApiKey[]) =>
		keys.filter((key) => key.kind !== "playground").map((key) => key.id);
	const viewIds = selectableIds(filteredKeys);
	const pageIds = selectableIds(pageKeys);
	const selection = summarizeApiKeySelection(selected, pageIds, viewIds);
	const selectedKeys = filteredKeys.filter((key) =>
		selection.selectedIds.includes(key.id),
	);

	// Auto-switch to a tab with content if current tab becomes empty
	useEffect(() => {
		if (statusFilteredKeys.length === 0 && scopedKeys.length > 0) {
			if (statusFilter === "active" && inactiveKeys.length > 0) {
				setStatusFilter("inactive");
			} else if (statusFilter === "inactive" && activeKeys.length > 0) {
				setStatusFilter("active");
			} else if (statusFilter !== "all") {
				setStatusFilter("all");
			}
		}
	}, [
		statusFilteredKeys.length,
		scopedKeys.length,
		activeKeys.length,
		inactiveKeys.length,
		statusFilter,
	]);

	// Drop a usage filter once no key in the current status tab matches it.
	useEffect(() => {
		if (
			(usageFilter === "approaching" && approachingKeys.length === 0) ||
			(usageFilter === "reached" && reachedKeys.length === 0) ||
			(usageFilter === "unused" && unusedInStatus.length === 0)
		) {
			setUsageFilter("all");
		}
	}, [
		usageFilter,
		approachingKeys.length,
		reachedKeys.length,
		unusedInStatus.length,
	]);

	if (scope.type === "project" && !scope.project) {
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

	const invalidateApiKeys = () => {
		void queryClient.invalidateQueries({ queryKey: ["get", "/keys/api"] });
	};

	const deleteKey = (id: string) => {
		deleteMutation(
			{
				params: {
					path: { id },
				},
			},
			{
				onSuccess: () => {
					invalidateApiKeys();
					toast({ title: "API key deleted successfully." });
				},
			},
		);
	};

	const toggleStatus = (key: ApiKey) => {
		// Reactivating a key whose TTL has already passed requires a fresh future
		// expiration, so prompt for one instead of toggling directly.
		if (key.status !== "active") {
			const expiry = formatApiKeyExpiry(key.expiresAt);
			if (expiry?.expired) {
				setReactivateKey(key);
				return;
			}
		}

		const newStatus = key.status === "active" ? "inactive" : "active";

		toggleKeyStatus(
			{
				params: {
					path: { id: key.id },
				},
				body: {
					status: newStatus,
				},
			},
			{
				onSuccess: () => {
					invalidateApiKeys();

					toast({
						title: "API Key Status Updated",
						description: "The API key status has been updated.",
					});
				},
			},
		);
	};

	const handleReactivate = async (expiresAt: string) => {
		if (!reactivateKey) {
			return;
		}

		try {
			await toggleKeyStatusAsync({
				params: {
					path: { id: reactivateKey.id },
				},
				body: {
					status: "active",
					expiresAt,
				},
			});

			invalidateApiKeys();
			setReactivateKey(null);

			toast({
				title: "API Key Reactivated",
				description: "The API key is active again with a new expiration.",
			});
		} catch (error) {
			toast({
				title: "Failed to reactivate API key.",
				description: getApiErrorMessage(error, "Please try again."),
				variant: "destructive",
			});
		}
	};

	const handleRoll = async (): Promise<string | undefined> => {
		if (!rollKey) {
			return undefined;
		}

		try {
			const data = await rollKeyAsync({
				params: {
					path: { id: rollKey.id },
				},
			});

			invalidateApiKeys();

			toast({
				title: "API Key Rolled",
				description: "A new secret has been generated for this key.",
			});

			return data.apiKey.token;
		} catch (error) {
			toast({
				title: "Failed to roll API key.",
				description: getApiErrorMessage(error, "Please try again."),
				variant: "destructive",
			});
			return undefined;
		}
	};

	const handleRename = async (description: string) => {
		if (!renameKey) {
			return;
		}

		try {
			await renameKeyAsync({
				params: {
					path: { id: renameKey.id },
				},
				body: {
					description,
				},
			});

			invalidateApiKeys();
			setRenameKey(null);

			toast({
				title: "API Key Renamed",
				description: "The API key has been renamed.",
			});
		} catch (error) {
			toast({
				title: "Failed to rename API key.",
				description: getApiErrorMessage(error, "Please try again."),
				variant: "destructive",
			});
		}
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
						invalidateApiKeys();

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
				description: getApiErrorMessage(error, "Please try again."),
				variant: "destructive",
			});
			throw error;
		}
	};

	const renderUsage = (key: ApiKey) => {
		if (period !== "all") {
			return (
				<div className="space-y-0.5">
					<div className="font-mono text-xs">
						{formatCurrencyAmount(key.periodUsage ?? "0")}
					</div>
					<div className="text-muted-foreground text-xs">
						{formatNumber(key.periodRequestCount ?? 0)} request
						{key.periodRequestCount === 1 ? "" : "s"}
					</div>
				</div>
			);
		}

		const total = limitStatusOf(key).total;

		return (
			<div className="space-y-1">
				<div
					className={cn(
						"font-mono text-xs",
						total && apiKeyLimitTextTone[total.state],
					)}
				>
					{formatCurrencyAmount(key.usage)}
					{total ? ` / ${formatCurrencyAmount(total.limit)}` : ""}
				</div>
				{total && <ApiKeyLimitMeter gauge={total} />}
			</div>
		);
	};

	const renderCurrentPeriodUsage = (key: ApiKey) => {
		const summary = formatCurrentPeriodUsageSummary(key);
		const limitPeriod = limitStatusOf(key).period;
		const reached = limitPeriod?.state === "reached";

		return (
			<div className="space-y-1">
				<div
					className={cn(
						summary.windowLabel
							? "font-mono text-xs"
							: "text-muted-foreground text-xs",
						limitPeriod && apiKeyLimitTextTone[limitPeriod.state],
					)}
				>
					{summary.summary}
				</div>
				{limitPeriod && <ApiKeyLimitMeter gauge={limitPeriod} />}
				{summary.windowLabel && (
					<div className="text-muted-foreground text-xs">
						Every {summary.windowLabel}
					</div>
				)}
				{summary.resetLabel && (
					<div
						className={cn(
							"text-xs",
							reached
								? "text-destructive font-medium"
								: "text-muted-foreground",
						)}
					>
						{reached ? "Unblocks" : "Resets"} {summary.resetLabel}
					</div>
				)}
			</div>
		);
	};

	const renderExpiry = (key: ApiKey) => {
		const expiry = formatApiKeyExpiry(key.expiresAt);
		if (!expiry) {
			return null;
		}

		return (
			<div
				className={`text-xs ${expiry.expired ? "text-destructive" : "text-muted-foreground"}`}
			>
				{expiry.expired ? "Expired" : "Expires"} {expiry.label}
			</div>
		);
	};

	const renderLimitSummary = (key: ApiKey) => {
		const { period: limitPeriod, total } = limitStatusOf(key);

		return (
			<div className="text-left">
				<div
					className={cn(
						"font-mono text-xs",
						total && apiKeyLimitTextTone[total.state],
					)}
				>
					{key.usageLimit
						? formatCurrencyAmount(key.usageLimit)
						: "No all-time limit"}
				</div>
				<div
					className={cn(
						"text-xs",
						limitPeriod && limitPeriod.state !== "ok"
							? apiKeyLimitTextTone[limitPeriod.state]
							: "text-muted-foreground",
					)}
				>
					{formatPeriodLimitSummary(key)}
				</div>
			</div>
		);
	};

	const renderIamRules = (key: ApiKey, className?: string) => {
		const count = activeRuleCount(key);
		return (
			<Button
				variant={count ? "outline" : "ghost"}
				size="sm"
				className={cn("text-xs", !count && "text-muted-foreground", className)}
				asChild
			>
				<Link href={getIamRulesUrl(key)}>
					{count ? `${count} rule${count === 1 ? "" : "s"}` : "No rules"}
				</Link>
			</Button>
		);
	};

	const renderActions = (key: ApiKey) => (
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
					<Link href={getStatisticsUrl(key)} prefetch={true}>
						<BarChart3Icon className="mr-2 h-4 w-4" />
						View Statistics
					</Link>
				</DropdownMenuItem>
				<DropdownMenuItem asChild>
					<Link href={getIamRulesUrl(key)}>
						<Shield className="mr-2 h-4 w-4" />
						Manage IAM Rules
					</Link>
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem onClick={() => setRenameKey(key)}>
					<PencilIcon className="mr-2 h-4 w-4" />
					Rename Key
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => toggleStatus(key)}>
					<PowerIcon className="mr-2 h-4 w-4" />
					{key.status === "active" ? "Deactivate" : "Activate"} Key
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => setRollKey(key)}>
					<RefreshCwIcon className="mr-2 h-4 w-4" />
					Roll Key
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
							<AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
							<AlertDialogDescription>
								This action cannot be undone. This will permanently delete the
								API key and it will no longer be able to access your account.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction onClick={() => deleteKey(key.id)}>
								Delete
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</DropdownMenuContent>
		</DropdownMenu>
	);

	const renderRowCheckbox = (key: ApiKey) => (
		<SelectionCheckbox
			checked={selected.has(key.id)}
			onCheckedChange={() => setSelected(toggleKeySelection(selected, key.id))}
			aria-label={`Select ${key.description}`}
		/>
	);

	const createDialogProps =
		scope.type === "project"
			? { selectedProject: scope.project! }
			: { projects: scope.projects };
	const createDisabled = planLimits
		? planLimits.currentCount >= planLimits.maxKeys
		: false;

	if (allKeys.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-center">
				<div className="mb-4">
					<KeyIcon className="h-10 w-10 text-gray-500" />
				</div>
				<p className="text-gray-400 mb-6">No API keys have been created yet.</p>
				<CreateApiKeyDialog
					{...createDialogProps}
					disabled={createDisabled}
					disabledMessage={
						planLimits ? formatPlanLimitMessage(planLimits) : undefined
					}
				>
					<Button
						type="button"
						disabled={createDisabled}
						className="cursor-pointer flex items-center gap-2 bg-white text-black px-4 py-2 rounded-md hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
					>
						<PlusIcon className="h-5 w-5" />
						Create API Key
					</Button>
				</CreateApiKeyDialog>
			</div>
		);
	}

	const countBadge = (count: number, active: boolean) => (
		<Badge variant={active ? "default" : "outline"} className="text-xs">
			{count}
		</Badge>
	);

	const usageLabel = apiKeyUsagePeriodLabel(period);

	return (
		<div className="space-y-3">
			<div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
				{/* Creator Filter — hidden for developers (own keys only) */}
				{!isDeveloper && (
					<Tabs
						value={creatorFilter}
						onValueChange={(value) => {
							resetView();
							setCreatorFilter(value as CreatorFilter);
						}}
					>
						<TabsList className="w-full lg:w-fit">
							<TabsTrigger value="all">All Keys</TabsTrigger>
							<TabsTrigger value="mine">My Keys</TabsTrigger>
						</TabsList>
					</Tabs>
				)}

				<Tabs
					value={statusFilter}
					onValueChange={(value) => {
						resetView();
						setStatusFilter(value as StatusFilter);
					}}
				>
					<TabsList className="w-full lg:w-fit">
						<TabsTrigger value="all">
							All {countBadge(scopedKeys.length, statusFilter === "all")}
						</TabsTrigger>
						{activeKeys.length > 0 && (
							<TabsTrigger value="active">
								Active{" "}
								{countBadge(activeKeys.length, statusFilter === "active")}
							</TabsTrigger>
						)}
						{inactiveKeys.length > 0 && (
							<TabsTrigger value="inactive">
								Inactive{" "}
								{countBadge(inactiveKeys.length, statusFilter === "inactive")}
							</TabsTrigger>
						)}
					</TabsList>
				</Tabs>

				{(approachingKeys.length > 0 ||
					reachedKeys.length > 0 ||
					unusedInStatus.length > 0) && (
					<Tabs
						value={usageFilter}
						onValueChange={(value) => {
							resetView();
							setUsageFilter(value as UsageFilter);
						}}
					>
						<TabsList className="w-full lg:w-fit">
							<TabsTrigger value="all">Any usage</TabsTrigger>
							{approachingKeys.length > 0 && (
								<TabsTrigger value="approaching">
									Near limit{" "}
									{countBadge(
										approachingKeys.length,
										usageFilter === "approaching",
									)}
								</TabsTrigger>
							)}
							{reachedKeys.length > 0 && (
								<TabsTrigger value="reached">
									Limit reached{" "}
									{countBadge(reachedKeys.length, usageFilter === "reached")}
								</TabsTrigger>
							)}
							{unusedInStatus.length > 0 && (
								<TabsTrigger value="unused">
									Unused{" "}
									{countBadge(unusedInStatus.length, usageFilter === "unused")}
								</TabsTrigger>
							)}
						</TabsList>
					</Tabs>
				)}

				<div className="flex flex-col gap-2 md:flex-row lg:ml-auto">
					{scope.type === "organization" && (
						<Select
							value={projectFilter}
							onValueChange={(value) => {
								resetView();
								setProjectFilter(value);
							}}
						>
							<SelectTrigger
								size="sm"
								className="w-full md:w-44"
								aria-label="Project"
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value={ALL_PROJECTS}>All projects</SelectItem>
								{scope.projects.map((project) => (
									<SelectItem key={project.id} value={project.id}>
										{project.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
					<div className="relative">
						<SearchIcon className="text-muted-foreground absolute left-2.5 top-2 h-4 w-4" />
						<Input
							value={search}
							onChange={(event) => {
								resetView();
								setSearch(event.target.value);
							}}
							placeholder="Search keys"
							aria-label="Search API keys"
							className="h-8 w-full pl-8 md:w-48"
						/>
					</div>
					<ApiKeyUsagePeriodSelect value={period} onChange={setPeriod} />
				</div>
			</div>

			{planLimits && (
				<div className="text-muted-foreground flex flex-wrap items-center gap-x-3 text-xs">
					<span>
						<span className="font-medium">Active API keys:</span>{" "}
						{planLimits.currentCount} of {planLimits.maxKeys} used across the
						organization
					</span>
					{planLimits.currentCount >= planLimits.maxKeys && (
						<span className="text-amber-600 font-medium">
							Limit reached — contact us at contact@llmgateway.io to unlock more
						</span>
					)}
				</div>
			)}

			<ApiKeyInsightsSummary
				warningCount={unusedKeys.length - criticalUnusedCount}
				criticalCount={criticalUnusedCount}
				showingUnused={usageFilter === "unused"}
				onShowUnused={() => {
					resetView();
					setStatusFilter("active");
					setUsageFilter("unused");
				}}
				onSelectUnused={() => {
					setPage(0);
					setStatusFilter("active");
					setUsageFilter("unused");
					setSelected(new Set(unusedKeys.map((key) => key.id)));
				}}
			/>

			<ApiKeysBulkActionBar
				selectedKeys={selectedKeys}
				onClear={() => setSelected(new Set())}
			/>
			<ApiKeysSelectionBanner
				selectedCount={selection.selectedIds.length}
				pageCount={pageIds.length}
				viewCount={viewIds.length}
				allPageSelected={selection.allPageSelected}
				allViewSelected={selection.allViewSelected}
				viewExceedsPage={selection.viewExceedsPage}
				onSelectView={() => setSelected(new Set(viewIds))}
				onClear={() => setSelected(new Set())}
			/>

			{filteredKeys.length === 0 && (
				<div className="text-muted-foreground py-10 text-center text-sm">
					No API keys match the selected filters.
				</div>
			)}

			{/* Desktop Table */}
			{filteredKeys.length > 0 && (
				<div className="hidden md:block overflow-x-auto">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="w-8">
									<Tooltip>
										<TooltipTrigger asChild>
											<span className="inline-flex">
												<SelectionCheckbox
													checked={
														selection.allPageSelected
															? true
															: selection.somePageSelected
																? "indeterminate"
																: false
													}
													disabled={!pageIds.length}
													onCheckedChange={() =>
														setSelected(togglePageSelection(selected, pageIds))
													}
													aria-label={`Select all ${pageIds.length} keys on this page`}
												/>
											</span>
										</TooltipTrigger>
										<TooltipContent>
											<p className="text-xs">
												{selection.allPageSelected
													? "Clear the keys on this page"
													: `Select the ${pageIds.length} keys on this page`}
											</p>
										</TooltipContent>
									</Tooltip>
								</TableHead>
								<TableHead>Name</TableHead>
								{isOrgScope && <TableHead>Project</TableHead>}
								<TableHead className="w-40">API Key</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Created</TableHead>
								<TableHead>Last Used</TableHead>
								<TableHead>Created By</TableHead>
								<TableHead>
									Usage
									{period !== "all" && (
										<span className="text-muted-foreground block text-xs font-normal">
											{usageLabel}
										</span>
									)}
								</TableHead>
								<TableHead>Current Period</TableHead>
								<TableHead>Limits</TableHead>
								<TableHead>IAM Rules</TableHead>
								<TableHead className="sticky right-0 bg-card w-12" />
							</TableRow>
						</TableHeader>
						<TableBody>
							{pageKeys.map((key) => {
								if (key.kind === "playground") {
									return (
										<ManagedPlaygroundTableRow
											key={key.id}
											apiKey={key}
											statisticsUrl={getStatisticsUrl(key)}
											projectName={
												isOrgScope
													? (projectNames.get(key.projectId) ?? "—")
													: undefined
											}
											usage={renderUsage(key)}
											lastUsed={renderLastUsed(key)}
										/>
									);
								}

								return (
									<TableRow
										key={key.id}
										data-state={selected.has(key.id) ? "selected" : undefined}
										className="hover:bg-muted/30 transition-colors"
									>
										<TableCell>{renderRowCheckbox(key)}</TableCell>
										<TableCell className="font-medium">
											<div className="flex flex-col items-start gap-1">
												<span className="text-sm font-medium">
													{key.description}
												</span>
												<ApiKeyUnusedBadge insight={insightOf(key)} />
											</div>
										</TableCell>
										{isOrgScope && (
											<TableCell className="text-muted-foreground text-sm">
												{projectNames.get(key.projectId) ?? "—"}
											</TableCell>
										)}
										<TableCell className="min-w-40 max-w-40">
											<span className="font-mono text-xs truncate">
												{key.maskedToken}
											</span>
										</TableCell>
										<TableCell>
											<div className="space-y-1">
												<StatusBadge status={key.status} variant="detailed" />
												<ApiKeyLimitBadge
													apiKey={key}
													status={limitStatusOf(key)}
												/>
												{renderExpiry(key)}
											</div>
										</TableCell>
										<TableCell>
											<Tooltip>
												<TooltipTrigger asChild>
													<span className="text-muted-foreground cursor-help border-b border-dotted border-muted-foreground/50 hover:border-muted-foreground">
														<Time date={key.createdAt} format="monthDayYear" />
													</span>
												</TooltipTrigger>
												<TooltipContent>
													<p className="max-w-xs text-xs whitespace-nowrap">
														<Time
															date={key.createdAt}
															format="monthDayYearHourMinuteZone"
														/>
													</p>
												</TooltipContent>
											</Tooltip>
										</TableCell>
										<TableCell>{renderLastUsed(key)}</TableCell>
										<TableCell>
											<Tooltip>
												<TooltipTrigger asChild>
													<span className="text-muted-foreground cursor-help">
														{key.creator?.name ??
															key.creator?.email ??
															"Unknown"}
													</span>
												</TooltipTrigger>
												<TooltipContent>
													<p className="max-w-xs text-xs">
														{key.creator?.email ?? "No email available"}
													</p>
												</TooltipContent>
											</Tooltip>
										</TableCell>
										<TableCell>{renderUsage(key)}</TableCell>
										<TableCell>{renderCurrentPeriodUsage(key)}</TableCell>
										<TableCell>
											<ApiKeyLimitsDialog
												apiKey={key}
												onSubmit={(payload) =>
													updateKeyUsageLimit(key.id, payload)
												}
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
										<TableCell>{renderIamRules(key)}</TableCell>
										<TableCell className="sticky right-0 bg-card group-hover:bg-muted/30 text-center">
											{renderActions(key)}
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				</div>
			)}

			{/* Mobile Cards */}
			{filteredKeys.length > 0 && (
				<div className="md:hidden space-y-3">
					{pageIds.length > 0 && (
						<label className="flex items-center gap-2 text-sm">
							<SelectionCheckbox
								checked={
									selection.allPageSelected
										? true
										: selection.somePageSelected
											? "indeterminate"
											: false
								}
								onCheckedChange={() =>
									setSelected(togglePageSelection(selected, pageIds))
								}
							/>
							Select the {pageIds.length} keys on this page
						</label>
					)}
					{pageKeys.map((key) => {
						if (key.kind === "playground") {
							return (
								<ManagedPlaygroundCard
									key={key.id}
									apiKey={key}
									statisticsUrl={getStatisticsUrl(key)}
									usage={renderUsage(key)}
								/>
							);
						}

						return (
							<div key={key.id} className="border rounded-lg p-3 space-y-3">
								<div className="flex items-start justify-between gap-2">
									<div className="pt-0.5">{renderRowCheckbox(key)}</div>
									<div className="flex-1 min-w-0 space-y-1">
										<div className="flex flex-wrap items-center gap-2">
											<h3 className="font-medium text-sm">{key.description}</h3>
											<StatusBadge status={key.status} />
											<ApiKeyLimitBadge
												apiKey={key}
												status={limitStatusOf(key)}
											/>
											<ApiKeyUnusedBadge insight={insightOf(key)} />
										</div>
										{isOrgScope && (
											<div className="text-muted-foreground text-xs">
												{projectNames.get(key.projectId) ?? "—"}
											</div>
										)}
										{renderExpiry(key)}
										<div className="text-xs text-muted-foreground">
											Created{" "}
											<Time
												date={key.createdAt}
												format="monthDayYearHourMinuteZone"
											/>{" "}
											by {key.creator?.name ?? key.creator?.email ?? "Unknown"}
										</div>
										<div className="text-xs text-muted-foreground">
											Last used {renderLastUsed(key)}
										</div>
									</div>
									{renderActions(key)}
								</div>
								<div className="pt-2 border-t font-mono text-xs break-all">
									{key.maskedToken}
								</div>
								<div className="pt-2 border-t grid grid-cols-2 gap-3">
									<div>
										<div className="text-xs text-muted-foreground mb-1">
											Usage · {usageLabel}
										</div>
										{renderUsage(key)}
									</div>
									<div>
										<div className="text-xs text-muted-foreground mb-1">
											Current Period
										</div>
										{renderCurrentPeriodUsage(key)}
									</div>
								</div>
								<div className="pt-2 border-t flex flex-wrap items-center gap-2">
									<ApiKeyLimitsDialog
										apiKey={key}
										onSubmit={(payload) => updateKeyUsageLimit(key.id, payload)}
									>
										<Button
											variant="outline"
											size="sm"
											className="flex h-auto justify-between gap-3 py-1.5"
										>
											{renderLimitSummary(key)}
											<EditIcon />
										</Button>
									</ApiKeyLimitsDialog>
									{renderIamRules(key, "h-7")}
								</div>
							</div>
						);
					})}
				</div>
			)}

			{filteredKeys.length > API_KEYS_PAGE_SIZE && (
				<div className="flex items-center justify-between gap-2 text-sm">
					<span className="text-muted-foreground">
						Showing {pageStart + 1}–{pageStart + pageKeys.length} of{" "}
						{filteredKeys.length} keys
					</span>
					<div className="flex gap-2">
						<Button
							variant="outline"
							size="sm"
							disabled={currentPage === 0}
							onClick={() => setPage(currentPage - 1)}
						>
							<ChevronLeftIcon className="h-4 w-4" />
							Previous
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={currentPage >= pageCount - 1}
							onClick={() => setPage(currentPage + 1)}
						>
							Next
							<ChevronRightIcon className="h-4 w-4" />
						</Button>
					</div>
				</div>
			)}

			<ReactivateApiKeyDialog
				apiKey={reactivateKey}
				open={reactivateKey !== null}
				onOpenChange={(open) => {
					if (!open) {
						setReactivateKey(null);
					}
				}}
				onConfirm={handleReactivate}
				isPending={isTogglePending}
			/>

			<RollApiKeyDialog
				apiKey={rollKey}
				open={rollKey !== null}
				onOpenChange={(open) => {
					if (!open) {
						setRollKey(null);
					}
				}}
				onConfirm={handleRoll}
				isPending={isRollPending}
			/>

			<RenameApiKeyDialog
				apiKey={renameKey}
				open={renameKey !== null}
				onOpenChange={(open) => {
					if (!open) {
						setRenameKey(null);
					}
				}}
				onConfirm={handleRename}
				isPending={isRenamePending}
			/>
		</div>
	);
}
