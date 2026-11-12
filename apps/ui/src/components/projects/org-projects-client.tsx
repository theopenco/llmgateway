"use client";

import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import {
	Activity,
	Archive,
	ExternalLink,
	FolderPlus,
	KeyRound,
	MoreHorizontal,
	Moon,
	Pencil,
	Search,
	Settings2,
	XIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Sparkline } from "@/components/dashboard/metric-card";
import { NewProjectDialog } from "@/components/dashboard/new-project-dialog";
import { DateRangePicker } from "@/components/date-range-picker";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { useZonedRangeDefaults } from "@/hooks/useZonedRangeDefaults";
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
} from "@/lib/components/alert-dialog";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/lib/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/lib/components/dropdown-menu";
import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import { SelectionCheckbox } from "@/lib/components/selection-checkbox";
import { Skeleton } from "@/lib/components/skeleton";
import { toast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import { isDayKey } from "@llmgateway/shared";
import {
	formatCompactNumber,
	formatNumber,
} from "@llmgateway/shared/number-format";
import {
	canManageProject,
	type OrganizationRole,
} from "@llmgateway/shared/organization-roles";

import type { Project } from "@/lib/types";
import type { Route } from "next";

/** Day offset of the default window's start: today plus the 29 days before. */
const DEFAULT_RANGE_OFFSET = 29;

const DAY_MS = 86_400_000;

/** Longer windows (e.g. "All time") read better as "in period" than "2000d". */
const MAX_RELATIVE_LABEL_DAYS = 366;

function dayCount(from: string, to: string) {
	return (
		Math.round(
			(Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
				DAY_MS,
		) + 1
	);
}

const STATUS_FILTERS = ["all", "active", "idle", "never"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const SORTS = {
	requests: "Most requests",
	cost: "Highest spend",
	recent: "Recently active",
	name: "Name",
	created: "Newest",
} as const;
type Sort = keyof typeof SORTS;

const MODE_LABELS: Record<Project["mode"], string> = {
	"api-keys": "Provider keys",
	credits: "Credits",
	hybrid: "Hybrid",
};

const ROUTING_LABELS: Record<Project["defaultRoutingStrategy"], string> = {
	auto: "Auto",
	price: "Price",
	throughput: "Throughput",
	latency: "Latency",
};

const NO_CHANGE = "unchanged";

interface DailyUsage {
	date: string;
	requestCount: number;
	cost: number;
}

interface ProjectUsage {
	projectId: string;
	requestCount: number;
	errorCount: number;
	totalTokens: number;
	cost: number;
	lastActiveAt: string | null;
	apiKeyCount: number;
	daily: DailyUsage[];
}

type ActivityState = "active" | "idle" | "never";

interface ProjectRow {
	project: Project;
	usage: ProjectUsage | undefined;
	activity: ActivityState | null;
}

const usd = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
});

function formatCost(value: number) {
	if (value > 0 && value < 0.01) {
		return "<$0.01";
	}
	return usd.format(value);
}

const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function formatLastActive(lastActiveAt: string | null) {
	if (!lastActiveAt) {
		return "Never used";
	}
	const hours = (Date.now() - new Date(lastActiveAt).getTime()) / 3_600_000;
	if (hours < 1) {
		return "Active this hour";
	}
	if (hours < 24) {
		return `Active ${relativeTime.format(-Math.floor(hours), "hour")}`;
	}
	const days = Math.floor(hours / 24);
	if (days < 60) {
		return `Active ${relativeTime.format(-days, "day")}`;
	}
	return `Active ${relativeTime.format(-Math.floor(days / 30), "month")}`;
}

function activityOf(usage: ProjectUsage | undefined): ActivityState {
	if (!usage?.lastActiveAt) {
		return "never";
	}
	return usage.requestCount > 0 ? "active" : "idle";
}

function pluralProjects(count: number) {
	return `${count} ${count === 1 ? "project" : "projects"}`;
}

const ACTIVITY_BADGES: Record<
	ActivityState,
	{ label: string; className: string }
> = {
	active: {
		label: "Active",
		className:
			"border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
	},
	idle: {
		label: "Idle",
		className:
			"border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
	},
	never: {
		label: "No traffic yet",
		className: "border-border bg-muted text-muted-foreground",
	},
};

export function OrgProjectsClient() {
	const params = useParams();
	const orgId = params.orgId as string;
	const router = useRouter();
	const searchParams = useSearchParams();
	const api = useApi();
	const queryClient = useQueryClient();
	const { selectedOrganization, buildOrgUrl } = useDashboardNavigation();
	const {
		from: defaultFrom,
		to: defaultTo,
		timeZone,
		markGenerated,
		shouldApplyDefaults,
	} = useZonedRangeDefaults(DEFAULT_RANGE_OFFSET);

	const role = selectedOrganization?.role as OrganizationRole | undefined;
	const canEdit = canManageProject(role);
	const canArchive = role === "owner";

	const fromParam = searchParams.get("from");
	const toParam = searchParams.get("to");
	const validRange =
		isDayKey(fromParam) && isDayKey(toParam) && fromParam <= toParam;
	const malformedRange =
		(fromParam !== null || toParam !== null) && !validRange;

	// The date picker reads its range from the URL, so seed it with the default
	// and replace a malformed one.
	useEffect(() => {
		if (!malformedRange && !shouldApplyDefaults(searchParams)) {
			return;
		}
		const next = new URLSearchParams(searchParams.toString());
		next.set("from", defaultFrom);
		next.set("to", defaultTo);
		markGenerated(next);
		router.replace(
			`${buildOrgUrl("org/projects")}?${next.toString()}` as Route,
		);
	}, [
		searchParams,
		malformedRange,
		router,
		buildOrgUrl,
		defaultFrom,
		defaultTo,
		markGenerated,
		shouldApplyDefaults,
	]);

	const from = validRange ? fromParam : defaultFrom;
	const to = validRange ? toParam : defaultTo;
	// Relative labels ("Active in 30d") only fit a window ending today.
	const trailingDays =
		to === defaultTo && dayCount(from, to) <= MAX_RELATIVE_LABEL_DAYS
			? dayCount(from, to)
			: null;

	const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
	const [sort, setSort] = useState<Sort>("requests");
	const [search, setSearch] = useState("");
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [bulkEditOpen, setBulkEditOpen] = useState(false);
	const [archiveTargets, setArchiveTargets] = useState<Project[]>([]);
	const [renameTarget, setRenameTarget] = useState<Project | null>(null);
	const [newProjectOpen, setNewProjectOpen] = useState(false);

	const projectsQuery = api.useQuery("get", "/orgs/{id}/projects", {
		params: { path: { id: orgId } },
	});
	const usageQuery = api.useQuery(
		"get",
		"/orgs/{id}/projects/usage",
		{
			params: {
				path: { id: orgId },
				query: { from, to, timezone: timeZone },
			},
		},
		{ staleTime: 60 * 1000, placeholderData: keepPreviousData },
	);
	const usageReady = usageQuery.data !== undefined;

	const usageById = useMemo(
		() =>
			new Map(
				(usageQuery.data?.projects ?? []).map((usage) => [
					usage.projectId,
					usage,
				]),
			),
		[usageQuery.data],
	);

	const rows = useMemo<ProjectRow[]>(
		() =>
			(projectsQuery.data?.projects ?? []).map((project) => {
				const usage = usageById.get(project.id);
				return {
					project,
					usage,
					activity: usageReady ? activityOf(usage) : null,
				};
			}),
		[projectsQuery.data, usageById, usageReady],
	);

	const counts = useMemo(() => {
		const result: Record<StatusFilter, number> = {
			all: rows.length,
			active: 0,
			idle: 0,
			never: 0,
		};
		for (const row of rows) {
			if (row.activity) {
				result[row.activity] += 1;
			}
		}
		return result;
	}, [rows]);

	const totals = useMemo(() => {
		const daily = new Map<string, number>();
		let requests = 0;
		let cost = 0;
		for (const row of rows) {
			requests += row.usage?.requestCount ?? 0;
			cost += row.usage?.cost ?? 0;
			for (const day of row.usage?.daily ?? []) {
				daily.set(day.date, (daily.get(day.date) ?? 0) + day.requestCount);
			}
		}
		return { requests, cost, trend: Array.from(daily.values()) };
	}, [rows]);

	const visibleRows = useMemo(() => {
		const needle = search.trim().toLowerCase();
		const filtered = rows.filter(
			(row) =>
				(statusFilter === "all" || row.activity === statusFilter) &&
				(!needle ||
					row.project.name.toLowerCase().includes(needle) ||
					row.project.id.toLowerCase().includes(needle)),
		);
		const lastActive = (row: ProjectRow) =>
			row.usage?.lastActiveAt ? new Date(row.usage.lastActiveAt).getTime() : 0;
		return filtered.sort((a, b) => {
			switch (sort) {
				case "requests":
					return (
						(b.usage?.requestCount ?? 0) - (a.usage?.requestCount ?? 0) ||
						lastActive(b) - lastActive(a)
					);
				case "cost":
					return (b.usage?.cost ?? 0) - (a.usage?.cost ?? 0);
				case "recent":
					return lastActive(b) - lastActive(a);
				case "created":
					return (
						new Date(b.project.createdAt).getTime() -
						new Date(a.project.createdAt).getTime()
					);
				default:
					return a.project.name.localeCompare(b.project.name);
			}
		});
	}, [rows, search, sort, statusFilter]);

	const selectedProjects = rows
		.filter((row) => selected.has(row.project.id))
		.map((row) => row.project);
	const allVisibleSelected =
		visibleRows.length > 0 &&
		visibleRows.every((row) => selected.has(row.project.id));
	const someVisibleSelected = visibleRows.some((row) =>
		selected.has(row.project.id),
	);

	const toggle = (projectId: string) =>
		setSelected((current) => {
			const next = new Set(current);
			if (next.has(projectId)) {
				next.delete(projectId);
			} else {
				next.add(projectId);
			}
			return next;
		});

	const toggleAllVisible = () =>
		setSelected((current) => {
			const next = new Set(current);
			for (const row of visibleRows) {
				if (allVisibleSelected) {
					next.delete(row.project.id);
				} else {
					next.add(row.project.id);
				}
			}
			return next;
		});

	const invalidateProjects = () =>
		Promise.all([
			queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/orgs/{id}/projects", {
					params: { path: { id: orgId } },
				}).queryKey,
			}),
			queryClient.invalidateQueries({
				queryKey: ["get", "/orgs/{id}/projects/usage"],
			}),
		]);

	const bulkMutation = api.useMutation("post", "/orgs/{id}/projects/bulk");

	const runBulk = async (
		body:
			| { action: "delete"; ids: string[] }
			| {
					action: "update";
					ids: string[];
					settings: {
						mode?: Project["mode"];
						cachingEnabled?: boolean;
						defaultRoutingStrategy?: Project["defaultRoutingStrategy"];
					};
			  },
	) => {
		const verb = body.action === "delete" ? "archived" : "updated";
		try {
			const result = await bulkMutation.mutateAsync({
				params: { path: { id: orgId } },
				body,
			});
			const failures = new Map<string, number>();
			for (const failure of result.failed) {
				failures.set(failure.message, (failures.get(failure.message) ?? 0) + 1);
			}
			const details = [
				result.skipped.length
					? `${pluralProjects(result.skipped.length)} already up to date.`
					: null,
				...Array.from(failures).map(
					([message, count]) =>
						`${pluralProjects(count)} not ${verb}: ${message}`,
				),
			].filter(Boolean);
			toast({
				title: `${pluralProjects(result.succeeded.length)} ${verb}`,
				description: details.length ? details.join(" ") : undefined,
				variant:
					failures.size && !result.succeeded.length ? "destructive" : "default",
			});
			setSelected((current) => {
				const next = new Set(current);
				for (const id of result.succeeded) {
					next.delete(id);
				}
				return next;
			});
			return true;
		} catch (error) {
			toast({
				title: `Projects not ${verb}`,
				description: getApiErrorMessage(error, "Please try again."),
				variant: "destructive",
			});
			return false;
		} finally {
			await invalidateProjects();
			router.refresh();
		}
	};

	const isLoading = projectsQuery.isLoading;

	return (
		<div className="flex flex-col">
			<div className="flex flex-col gap-6 p-4 pt-6 md:p-8">
				<div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
					<div>
						<h2 className="text-3xl font-bold tracking-tight">Projects</h2>
						<p className="text-muted-foreground">
							Usage, activity and settings for every project in this
							organization.
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						{/* The picker throws on unparseable dates; wait for the URL fix. */}
						{!malformedRange && (
							<DateRangePicker buildUrl={buildOrgUrl} path="org/projects" />
						)}
						<Button onClick={() => setNewProjectOpen(true)}>
							<FolderPlus className="h-4 w-4" />
							New project
						</Button>
					</div>
				</div>

				<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
					<SummaryTile
						label="Projects"
						value={formatNumber(counts.all)}
						isLoading={isLoading}
					/>
					<SummaryTile
						label={
							trailingDays ? `Active in ${trailingDays}d` : "Active in period"
						}
						value={formatNumber(counts.active)}
						hint={
							counts.all
								? `${Math.round((counts.active / counts.all) * 100)}% of projects`
								: undefined
						}
						isLoading={isLoading || usageQuery.isLoading}
					/>
					<SummaryTile
						label="Requests"
						value={formatCompactNumber(totals.requests)}
						trend={totals.trend}
						isLoading={usageQuery.isLoading}
					/>
					<SummaryTile
						label="Spend"
						value={formatCost(totals.cost)}
						isLoading={usageQuery.isLoading}
					/>
				</div>

				<div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
					<div className="flex flex-wrap gap-1.5">
						{STATUS_FILTERS.map((filter) => (
							<button
								key={filter}
								type="button"
								onClick={() => setStatusFilter(filter)}
								aria-pressed={statusFilter === filter}
								className={cn(
									"inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
									statusFilter === filter
										? "border-primary bg-primary text-primary-foreground"
										: "text-muted-foreground hover:text-foreground hover:bg-muted",
								)}
							>
								{filter === "all"
									? "All"
									: filter === "active"
										? "Active"
										: filter === "idle"
											? trailingDays
												? `Idle ${trailingDays}d+`
												: "Idle"
											: "Never used"}
								{filter === "all" || usageReady ? (
									<span className="tabular-nums opacity-70">
										{counts[filter]}
									</span>
								) : null}
							</button>
						))}
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<div className="relative">
							<Search className="text-muted-foreground absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2" />
							<Input
								value={search}
								onChange={(event) => setSearch(event.target.value)}
								placeholder="Search projects"
								aria-label="Search projects"
								className="w-full pl-8 sm:w-56"
							/>
						</div>
						<Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
							<SelectTrigger className="w-40" aria-label="Sort projects">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{Object.entries(SORTS).map(([value, label]) => (
									<SelectItem key={value} value={value}>
										{label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</div>

				{canEdit && visibleRows.length > 0 ? (
					<div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-md border bg-card px-3 py-2 shadow-sm">
						<label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
							<SelectionCheckbox
								checked={
									allVisibleSelected
										? true
										: someVisibleSelected
											? "indeterminate"
											: false
								}
								onCheckedChange={toggleAllVisible}
								aria-label="Select all visible projects"
							/>
							{selected.size ? `${selected.size} selected` : "Select all"}
						</label>
						{selected.size ? (
							<Button
								variant="ghost"
								size="sm"
								className="h-7 px-2"
								onClick={() => setSelected(new Set())}
							>
								<XIcon className="h-3.5 w-3.5" />
								Clear
							</Button>
						) : null}
						<div className="ml-auto flex flex-wrap gap-2">
							<Button
								variant="outline"
								size="sm"
								disabled={!selected.size || bulkMutation.isPending}
								onClick={() => setBulkEditOpen(true)}
							>
								<Settings2 className="h-3.5 w-3.5" />
								Edit settings
							</Button>
							{canArchive ? (
								<Button
									variant="destructive"
									size="sm"
									disabled={!selected.size || bulkMutation.isPending}
									onClick={() => setArchiveTargets(selectedProjects)}
								>
									<Archive className="h-3.5 w-3.5" />
									Archive
								</Button>
							) : null}
						</div>
					</div>
				) : null}

				{usageQuery.isError ? (
					<div
						role="alert"
						className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
					>
						Usage could not be loaded. Activity and usage figures are
						unavailable.{" "}
						<button
							type="button"
							className="font-medium underline underline-offset-4"
							onClick={() => void usageQuery.refetch()}
						>
							Retry
						</button>
					</div>
				) : null}

				{projectsQuery.isError ? (
					<div
						role="alert"
						className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-8 text-center text-sm"
					>
						<p className="text-muted-foreground">
							Projects could not be loaded.
						</p>
						<Button
							variant="outline"
							size="sm"
							onClick={() => void projectsQuery.refetch()}
						>
							Retry
						</Button>
					</div>
				) : isLoading ? (
					<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
						{Array.from({ length: 6 }, (_, index) => (
							<Skeleton key={index} className="h-56 rounded-xl" />
						))}
					</div>
				) : visibleRows.length ? (
					<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
						{visibleRows.map((row) => (
							<ProjectCard
								key={row.project.id}
								row={row}
								orgId={orgId}
								trailingDays={trailingDays}
								usageLoading={usageQuery.isLoading}
								selectable={canEdit}
								selected={selected.has(row.project.id)}
								onToggle={() => toggle(row.project.id)}
								onRename={canEdit ? () => setRenameTarget(row.project) : null}
								onArchive={
									canArchive ? () => setArchiveTargets([row.project]) : null
								}
							/>
						))}
					</div>
				) : (
					<div className="text-muted-foreground flex min-h-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-8 text-center text-sm">
						<Moon className="h-5 w-5" />
						{rows.length
							? "No projects match these filters."
							: "This organization has no projects yet."}
					</div>
				)}
			</div>

			<BulkEditDialog
				open={bulkEditOpen}
				onOpenChange={setBulkEditOpen}
				projects={selectedProjects}
				pending={bulkMutation.isPending}
				onSubmit={async (settings) => {
					if (
						await runBulk({
							action: "update",
							ids: selectedProjects.map((project) => project.id),
							settings,
						})
					) {
						setBulkEditOpen(false);
					}
				}}
			/>

			<AlertDialog
				open={archiveTargets.length > 0}
				onOpenChange={(open) => {
					if (!open) {
						setArchiveTargets([]);
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							Archive {pluralProjects(archiveTargets.length)}?
						</AlertDialogTitle>
						<AlertDialogDescription>
							{archiveTargets.length === 1
								? `"${archiveTargets[0]?.name}" will be removed from the project selector and its API keys will stop working.`
								: "These projects will be removed from the project selector and their API keys will stop working."}{" "}
							Historical usage and logs are kept. This cannot be undone from the
							dashboard.
						</AlertDialogDescription>
					</AlertDialogHeader>
					{archiveTargets.length > 1 ? (
						<ul className="text-muted-foreground max-h-40 list-inside list-disc overflow-y-auto text-sm">
							{archiveTargets.map((project) => (
								<li key={project.id}>{project.name}</li>
							))}
						</ul>
					) : null}
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							disabled={bulkMutation.isPending}
							className="bg-destructive text-white hover:bg-destructive/90"
							onClick={async (event) => {
								event.preventDefault();
								if (
									await runBulk({
										action: "delete",
										ids: archiveTargets.map((project) => project.id),
									})
								) {
									setArchiveTargets([]);
								}
							}}
						>
							{bulkMutation.isPending ? "Archiving..." : "Archive"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<RenameProjectDialog
				project={renameTarget}
				onClose={() => setRenameTarget(null)}
				onRenamed={async () => {
					setRenameTarget(null);
					await invalidateProjects();
					router.refresh();
				}}
			/>

			<NewProjectDialog
				isOpen={newProjectOpen}
				setIsOpen={setNewProjectOpen}
				selectedOrganization={selectedOrganization}
				onProjectCreated={() => {
					void invalidateProjects();
				}}
			/>
		</div>
	);
}

function SummaryTile({
	label,
	value,
	hint,
	trend,
	isLoading,
}: {
	label: string;
	value: string;
	hint?: string;
	trend?: number[];
	isLoading?: boolean;
}) {
	const showTrend = !isLoading && trend && trend.some((point) => point > 0);
	return (
		<div className="bg-card relative flex flex-col justify-between overflow-hidden rounded-xl border border-border/60 shadow-sm">
			<div className="p-4 pb-0">
				<p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
					{label}
				</p>
				{isLoading ? (
					<Skeleton className="mt-2 h-7 w-20" />
				) : (
					<p className="mt-1.5 text-2xl font-semibold tabular-nums">{value}</p>
				)}
				{hint && !isLoading ? (
					<p className="text-muted-foreground mt-0.5 text-xs">{hint}</p>
				) : null}
			</div>
			<div className={cn("h-8", !showTrend && "h-4")}>
				{showTrend ? <Sparkline trend={trend} color="#3b82f6" /> : null}
			</div>
		</div>
	);
}

function ProjectCard({
	row,
	orgId,
	trailingDays,
	usageLoading,
	selectable,
	selected,
	onToggle,
	onRename,
	onArchive,
}: {
	row: ProjectRow;
	orgId: string;
	trailingDays: number | null;
	usageLoading: boolean;
	selectable: boolean;
	selected: boolean;
	onToggle: () => void;
	onRename: (() => void) | null;
	onArchive: (() => void) | null;
}) {
	const { project, usage, activity } = row;
	const trend = usage?.daily.map((day) => day.requestCount) ?? [];
	const hasTrend = trend.some((point) => point > 0);
	const errorRate =
		usage && usage.requestCount
			? (usage.errorCount / usage.requestCount) * 100
			: null;
	const projectUrl = `/dashboard/${orgId}/${project.id}` as Route;
	const badge = activity ? ACTIVITY_BADGES[activity] : null;

	return (
		<div
			className={cn(
				"bg-card group relative flex flex-col overflow-hidden rounded-xl border border-border/60 shadow-sm transition-colors",
				selected && "border-primary ring-primary/30 ring-2",
				activity && activity !== "active" && !selected && "bg-card/60",
			)}
		>
			<div className="flex items-start gap-3 p-4 pb-2">
				{selectable ? (
					<SelectionCheckbox
						checked={selected}
						onCheckedChange={onToggle}
						aria-label={`Select ${project.name}`}
						className="mt-1"
					/>
				) : null}
				<div className="min-w-0 flex-1">
					<Link
						href={projectUrl}
						className="block truncate font-semibold hover:underline"
						title={project.name}
					>
						{project.name}
					</Link>
					<div className="mt-1.5 flex flex-wrap items-center gap-1.5">
						{badge ? (
							<Badge variant="outline" className={badge.className}>
								{badge.label}
							</Badge>
						) : null}
						<Badge variant="outline">{MODE_LABELS[project.mode]}</Badge>
						{project.cachingEnabled ? (
							<Badge variant="outline">Caching</Badge>
						) : null}
					</div>
				</div>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="h-8 w-8 shrink-0"
							aria-label={`Actions for ${project.name}`}
						>
							<MoreHorizontal className="h-4 w-4" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem asChild>
							<Link href={projectUrl}>
								<ExternalLink className="h-4 w-4" />
								Open dashboard
							</Link>
						</DropdownMenuItem>
						<DropdownMenuItem asChild>
							<Link href={`${projectUrl}/api-keys` as Route}>
								<KeyRound className="h-4 w-4" />
								API keys
							</Link>
						</DropdownMenuItem>
						<DropdownMenuItem asChild>
							<Link href={`${projectUrl}/settings` as Route}>
								<Settings2 className="h-4 w-4" />
								Settings
							</Link>
						</DropdownMenuItem>
						{onRename ? (
							<DropdownMenuItem onSelect={onRename}>
								<Pencil className="h-4 w-4" />
								Rename
							</DropdownMenuItem>
						) : null}
						{onArchive ? (
							<>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									onSelect={onArchive}
									className="text-destructive focus:text-destructive"
								>
									<Archive className="h-4 w-4" />
									Archive
								</DropdownMenuItem>
							</>
						) : null}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>

			<div className="h-14 px-1">
				{usageLoading || !usage ? (
					<Skeleton className="mx-3 h-12" />
				) : hasTrend ? (
					<Sparkline
						trend={trend}
						color={activity === "active" ? "#10b981" : "#94a3b8"}
					/>
				) : (
					<div className="text-muted-foreground flex h-full items-center justify-center gap-1.5 text-xs">
						<Moon className="h-3.5 w-3.5" />
						{trailingDays
							? `No requests in the last ${trailingDays} days`
							: "No requests in this period"}
					</div>
				)}
			</div>

			<dl className="grid grid-cols-3 gap-2 border-t px-4 py-3 text-sm">
				<Stat
					label="Requests"
					value={usage ? formatCompactNumber(usage.requestCount) : "–"}
				/>
				<Stat label="Spend" value={usage ? formatCost(usage.cost) : "–"} />
				<Stat
					label="Errors"
					value={errorRate === null ? "–" : `${errorRate.toFixed(1)}%`}
					tone={errorRate !== null && errorRate >= 5 ? "warn" : undefined}
				/>
			</dl>

			<div className="text-muted-foreground mt-auto flex items-center justify-between gap-2 border-t px-4 py-2.5 text-xs">
				<span className="flex items-center gap-1.5">
					<Activity className="h-3.5 w-3.5" />
					{usage ? formatLastActive(usage.lastActiveAt) : "–"}
				</span>
				<span className="flex items-center gap-3">
					<span title="Routing strategy">
						{ROUTING_LABELS[project.defaultRoutingStrategy]}
					</span>
					<span className="flex items-center gap-1">
						<KeyRound className="h-3.5 w-3.5" />
						{usage ? formatNumber(usage.apiKeyCount) : "–"}
					</span>
				</span>
			</div>
		</div>
	);
}

function Stat({
	label,
	value,
	tone,
}: {
	label: string;
	value: string;
	tone?: "warn";
}) {
	return (
		<div className="min-w-0">
			<dt className="text-muted-foreground text-xs">{label}</dt>
			<dd
				className={cn(
					"truncate font-medium tabular-nums",
					tone === "warn" && "text-amber-600 dark:text-amber-400",
				)}
			>
				{value}
			</dd>
		</div>
	);
}

function BulkEditDialog({
	open,
	onOpenChange,
	projects,
	pending,
	onSubmit,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	projects: Project[];
	pending: boolean;
	onSubmit: (settings: {
		mode?: Project["mode"];
		cachingEnabled?: boolean;
		defaultRoutingStrategy?: Project["defaultRoutingStrategy"];
	}) => Promise<void>;
}) {
	const [mode, setMode] = useState<string>(NO_CHANGE);
	const [caching, setCaching] = useState<string>(NO_CHANGE);
	const [routing, setRouting] = useState<string>(NO_CHANGE);
	const [wasOpen, setWasOpen] = useState(open);

	if (open !== wasOpen) {
		setWasOpen(open);
		if (open) {
			setMode(NO_CHANGE);
			setCaching(NO_CHANGE);
			setRouting(NO_CHANGE);
		}
	}

	const settings = {
		...(mode !== NO_CHANGE && { mode: mode as Project["mode"] }),
		...(caching !== NO_CHANGE && { cachingEnabled: caching === "on" }),
		...(routing !== NO_CHANGE && {
			defaultRoutingStrategy: routing as Project["defaultRoutingStrategy"],
		}),
	};
	const hasChanges = Object.keys(settings).length > 0;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Edit {pluralProjects(projects.length)}</DialogTitle>
					<DialogDescription>
						Only the settings you change are applied. Everything else stays as
						it is on each project.
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-4 py-2">
					<BulkSelect
						id="bulk-mode"
						label="Billing mode"
						value={mode}
						onChange={setMode}
						options={Object.entries(MODE_LABELS)}
					/>
					<BulkSelect
						id="bulk-caching"
						label="Response caching"
						value={caching}
						onChange={setCaching}
						options={[
							["on", "Enabled"],
							["off", "Disabled"],
						]}
					/>
					<BulkSelect
						id="bulk-routing"
						label="Routing strategy"
						value={routing}
						onChange={setRouting}
						options={Object.entries(ROUTING_LABELS)}
					/>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						disabled={!hasChanges || pending}
						onClick={() => void onSubmit(settings)}
					>
						{pending
							? "Applying..."
							: `Apply to ${pluralProjects(projects.length)}`}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function BulkSelect({
	id,
	label,
	value,
	onChange,
	options,
}: {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	options: [string, string][];
}) {
	return (
		<div className="grid gap-1.5">
			<Label htmlFor={id}>{label}</Label>
			<Select value={value} onValueChange={onChange}>
				<SelectTrigger id={id} className="w-full">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value={NO_CHANGE}>No change</SelectItem>
					{options.map(([optionValue, optionLabel]) => (
						<SelectItem key={optionValue} value={optionValue}>
							{optionLabel}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

function RenameProjectDialog({
	project,
	onClose,
	onRenamed,
}: {
	project: Project | null;
	onClose: () => void;
	onRenamed: () => Promise<void>;
}) {
	const api = useApi();
	const [name, setName] = useState("");
	const [projectId, setProjectId] = useState<string | null>(null);
	const rename = api.useMutation("patch", "/projects/{id}");

	if (project && project.id !== projectId) {
		setProjectId(project.id);
		setName(project.name);
	}

	const trimmed = name.trim();

	const close = () => {
		setProjectId(null);
		onClose();
	};

	return (
		<Dialog
			open={project !== null}
			onOpenChange={(open) => {
				if (!open) {
					close();
				}
			}}
		>
			<DialogContent>
				<form
					onSubmit={async (event) => {
						event.preventDefault();
						if (!project || !trimmed) {
							return;
						}
						try {
							await rename.mutateAsync({
								params: { path: { id: project.id } },
								body: { name: trimmed },
							});
						} catch {
							return;
						}
						toast({ title: "Project renamed" });
						setProjectId(null);
						await onRenamed();
					}}
				>
					<DialogHeader>
						<DialogTitle>Rename project</DialogTitle>
					</DialogHeader>
					<div className="grid gap-1.5 py-4">
						<Label htmlFor="rename-project">Name</Label>
						<Input
							id="rename-project"
							value={name}
							maxLength={255}
							onChange={(event) => setName(event.target.value)}
							autoFocus
						/>
					</div>
					<DialogFooter>
						<Button type="button" variant="outline" onClick={close}>
							Cancel
						</Button>
						<Button
							type="submit"
							disabled={
								!trimmed || trimmed === project?.name || rename.isPending
							}
						>
							{rename.isPending ? "Saving..." : "Save"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
