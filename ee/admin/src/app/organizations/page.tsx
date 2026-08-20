import {
	ArrowDown,
	ArrowUp,
	ArrowUpDown,
	ChevronLeft,
	ChevronRight,
	Search,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { BlockOrgButton } from "@/components/block-org-button";
import { BulkBlockOrgsButton } from "@/components/bulk-block-orgs-button";
import { DateRangePicker } from "@/components/date-range-picker";
import { OrgStatusToggleButton } from "@/components/org-status-toggle-button";
import { PlanTermBadge } from "@/components/plan-term-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	blockOrganization,
	bulkBlockOrganizations,
	previewBulkBlockOrganizations,
	setOrganizationStatus,
} from "@/lib/admin-organizations";
import {
	ORGANIZATIONS_DEFAULT_RANGE,
	resolveDateRangeFromSearchParams,
} from "@/lib/date-range";
import { getOrgDeletionBlockedReason } from "@/lib/org-deletion";
import { requireSession } from "@/lib/require-session";
import { createServerApiClient } from "@/lib/server-api";
import { cn } from "@/lib/utils";

import { MIN_BULK_BLOCK_SEARCH_LENGTH } from "@llmgateway/shared";

type SortBy =
	| "name"
	| "billingEmail"
	| "plan"
	| "devPlan"
	| "credits"
	| "createdAt"
	| "status"
	| "totalCreditsAllTime"
	| "totalSpent"
	| "totalRequests"
	| "totalTokens";
type SortOrder = "asc" | "desc";

// The date-range picker writes `range` (relative preset) or `from`/`to`
// (custom span) into the URL, so every link on this page has to carry them
// along or navigating would silently reset the window to all time.
interface DateRangeParams {
	range?: string;
	from?: string;
	to?: string;
}

function buildOrganizationsHref({
	page,
	sortBy,
	sortOrder,
	search,
	dateRange,
}: {
	page: number;
	sortBy: SortBy;
	sortOrder: SortOrder;
	search: string;
	dateRange: DateRangeParams;
}) {
	const params = new URLSearchParams();
	params.set("page", String(page));
	params.set("sortBy", sortBy);
	params.set("sortOrder", sortOrder);
	if (search) {
		params.set("search", search);
	}
	if (dateRange.range) {
		params.set("range", dateRange.range);
	}
	if (dateRange.from && dateRange.to) {
		params.set("from", dateRange.from);
		params.set("to", dateRange.to);
	}
	return `/organizations?${params.toString()}`;
}

function SortableHeader({
	label,
	sortKey,
	currentSortBy,
	currentSortOrder,
	search,
	dateRange,
}: {
	label: string;
	sortKey: SortBy;
	currentSortBy: SortBy;
	currentSortOrder: SortOrder;
	search: string;
	dateRange: DateRangeParams;
}) {
	const isActive = currentSortBy === sortKey;
	const nextOrder = isActive && currentSortOrder === "asc" ? "desc" : "asc";

	const href = buildOrganizationsHref({
		page: 1,
		sortBy: sortKey,
		sortOrder: nextOrder,
		search,
		dateRange,
	});

	return (
		<Link
			href={href}
			className={cn(
				"flex items-center gap-1 hover:text-foreground transition-colors",
				isActive ? "text-foreground" : "text-muted-foreground",
			)}
		>
			{label}
			{isActive ? (
				currentSortOrder === "asc" ? (
					<ArrowUp className="h-3.5 w-3.5" />
				) : (
					<ArrowDown className="h-3.5 w-3.5" />
				)
			) : (
				<ArrowUpDown className="h-3.5 w-3.5 opacity-50" />
			)}
		</Link>
	);
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat("en-US");

const compactNumberFormatter = new Intl.NumberFormat("en-US", {
	notation: "compact",
	maximumFractionDigits: 1,
});

function formatDate(dateString: string) {
	return new Date(dateString).toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

// The resolved range is a bare YYYY-MM-DD day, which `new Date()` reads as UTC
// midnight and would render as the previous day in western timezones.
function formatDay(day: string) {
	return formatDate(day + "T00:00:00");
}

function getPlanBadgeVariant(plan: string) {
	switch (plan) {
		case "enterprise":
			return "default";
		case "pro":
			return "secondary";
		default:
			return "outline";
	}
}

function getDevPlanBadgeVariant(devPlan: string) {
	switch (devPlan) {
		case "max":
			return "default";
		case "pro":
			return "secondary";
		case "lite":
			return "outline";
		default:
			return "outline";
	}
}

function SignInPrompt() {
	return (
		<div className="flex min-h-screen items-center justify-center px-4">
			<div className="w-full max-w-md text-center">
				<div className="mb-8">
					<h1 className="text-3xl font-semibold tracking-tight">
						Admin Dashboard
					</h1>
					<p className="mt-2 text-sm text-muted-foreground">
						Sign in to access the admin dashboard
					</p>
				</div>
				<Button asChild size="lg" className="w-full">
					<Link href="/login">Sign In</Link>
				</Button>
			</div>
		</div>
	);
}

export default async function OrganizationsPage({
	searchParams,
}: {
	searchParams?: Promise<{
		page?: string;
		search?: string;
		sortBy?: string;
		sortOrder?: string;
		range?: string;
		from?: string;
		to?: string;
	}>;
}) {
	await requireSession();

	const params = await searchParams;
	const page = Math.max(1, parseInt(params?.page ?? "1", 10));
	const search = params?.search ?? "";
	const sortBy = (params?.sortBy as SortBy) || "createdAt";
	const sortOrder = (params?.sortOrder as SortOrder) || "desc";
	const limit = 25;
	const offset = (page - 1) * limit;

	// An empty URL resolves to the page default rather than all time. `from`/`to`
	// stay undefined only when "All time" is picked explicitly, which lets the
	// API aggregate over the full history instead of a concrete span.
	const { from, to } = resolveDateRangeFromSearchParams(
		params ?? {},
		ORGANIZATIONS_DEFAULT_RANGE,
	);
	const dateRange: DateRangeParams = {
		range: params?.range,
		from: params?.from,
		to: params?.to,
	};
	const usageWindowLabel =
		from && to ? `${formatDay(from)} – ${formatDay(to)}` : "all time";

	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/organizations", {
		params: { query: { limit, offset, search, sortBy, sortOrder, from, to } },
	});

	if (!data) {
		return <SignInPrompt />;
	}

	const totalPages = Math.ceil(data.total / limit);

	async function handleSearch(formData: FormData) {
		"use server";
		const searchValue = formData.get("search") as string;
		const sortByValue = formData.get("sortBy") as SortBy;
		const sortOrderValue = formData.get("sortOrder") as SortOrder;
		redirect(
			buildOrganizationsHref({
				page: 1,
				sortBy: sortByValue,
				sortOrder: sortOrderValue,
				search: searchValue,
				dateRange: {
					range: (formData.get("range") as string) || undefined,
					from: (formData.get("from") as string) || undefined,
					to: (formData.get("to") as string) || undefined,
				},
			}),
		);
	}

	async function handleToggleOrgStatus(
		orgId: string,
		status: "active" | "deleted",
	): Promise<{ success: boolean; error?: string }> {
		"use server";

		return await setOrganizationStatus(orgId, status);
	}

	async function handleBlockOrganization(orgId: string) {
		"use server";

		return await blockOrganization(orgId);
	}

	async function handlePreviewBulkBlock(searchValue: string) {
		"use server";

		return await previewBulkBlockOrganizations(searchValue);
	}

	async function handleBulkBlock(searchValue: string, expectedCount: number) {
		"use server";

		return await bulkBlockOrganizations(searchValue, expectedCount);
	}

	return (
		<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
			<header className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
				<div>
					<h1 className="text-3xl font-semibold tracking-tight">
						Organizations
					</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						{data.total} organizations found • Total credits:{" "}
						{currencyFormatter.format(parseFloat(data.totalCredits))}
					</p>
					<p className="mt-1 text-xs text-muted-foreground">
						Spend, requests, and tokens cover {usageWindowLabel}.
					</p>
				</div>
				<div className="flex w-full items-start gap-2 sm:w-auto sm:items-center">
					<div className="flex min-w-0 flex-1 flex-col items-stretch gap-2 sm:flex-initial sm:flex-row sm:items-center">
						<DateRangePicker defaultRange={ORGANIZATIONS_DEFAULT_RANGE} />
						<form
							action={handleSearch}
							className="flex w-full items-center gap-2 sm:w-auto"
						>
							<input type="hidden" name="sortBy" value={sortBy} />
							<input type="hidden" name="sortOrder" value={sortOrder} />
							<input type="hidden" name="range" value={dateRange.range ?? ""} />
							<input type="hidden" name="from" value={dateRange.from ?? ""} />
							<input type="hidden" name="to" value={dateRange.to ?? ""} />
							<div className="relative flex-1 sm:flex-initial">
								<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
								<input
									type="text"
									name="search"
									placeholder="Search by name, email, member email, ID, or safety identifier..."
									defaultValue={search}
									className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:w-64"
								/>
							</div>
							<Button type="submit" size="sm">
								Search
							</Button>
						</form>
					</div>
					<BulkBlockOrgsButton
						search={search}
						minSearchLength={MIN_BULK_BLOCK_SEARCH_LENGTH}
						onPreview={handlePreviewBulkBlock}
						onBulkBlock={handleBulkBlock}
					/>
				</div>
			</header>

			<div className="overflow-x-auto rounded-lg border border-border/60 bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>
								<SortableHeader
									label="Organization"
									sortKey="name"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									search={search}
									dateRange={dateRange}
								/>
							</TableHead>
							<TableHead>
								<SortableHeader
									label="Email"
									sortKey="billingEmail"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									search={search}
									dateRange={dateRange}
								/>
							</TableHead>
							<TableHead>Kind</TableHead>
							<TableHead>
								<SortableHeader
									label="Plan"
									sortKey="plan"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									search={search}
									dateRange={dateRange}
								/>
							</TableHead>
							<TableHead>
								<SortableHeader
									label="Dev Plan"
									sortKey="devPlan"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									search={search}
									dateRange={dateRange}
								/>
							</TableHead>
							<TableHead>
								<SortableHeader
									label="Credits"
									sortKey="credits"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									search={search}
									dateRange={dateRange}
								/>
							</TableHead>
							<TableHead>
								<SortableHeader
									label="All Time Credits"
									sortKey="totalCreditsAllTime"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									search={search}
									dateRange={dateRange}
								/>
							</TableHead>
							<TableHead>
								<SortableHeader
									label="Total Spent"
									sortKey="totalSpent"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									search={search}
									dateRange={dateRange}
								/>
							</TableHead>
							<TableHead>
								<SortableHeader
									label="Requests"
									sortKey="totalRequests"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									search={search}
									dateRange={dateRange}
								/>
							</TableHead>
							<TableHead>
								<SortableHeader
									label="Tokens"
									sortKey="totalTokens"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									search={search}
									dateRange={dateRange}
								/>
							</TableHead>
							<TableHead>
								<SortableHeader
									label="Created"
									sortKey="createdAt"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									search={search}
									dateRange={dateRange}
								/>
							</TableHead>
							<TableHead>
								<SortableHeader
									label="Status"
									sortKey="status"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									search={search}
									dateRange={dateRange}
								/>
							</TableHead>
							<TableHead>Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.organizations.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={13}
									className="h-24 text-center text-muted-foreground"
								>
									No organizations found
								</TableCell>
							</TableRow>
						) : (
							data.organizations.map((org) => (
								<TableRow key={org.id}>
									<TableCell>
										<Link
											href={`/organizations/${org.id}`}
											className="font-medium text-foreground hover:underline"
										>
											{org.name}
										</Link>
										<p className="text-xs text-muted-foreground">{org.id}</p>
									</TableCell>
									<TableCell className="text-muted-foreground">
										{org.billingEmail}
									</TableCell>
									<TableCell>
										<Badge
											variant={org.kind === "default" ? "outline" : "secondary"}
										>
											{org.kind}
										</Badge>
									</TableCell>
									<TableCell>
										<div className="flex flex-col items-start gap-1">
											<Badge variant={getPlanBadgeVariant(org.plan)}>
												{org.plan}
											</Badge>
											<PlanTermBadge
												planExpiresAt={org.planExpiresAt}
												planStartedAt={org.planStartedAt}
												isTrialActive={org.isTrialActive}
												trialStartDate={org.trialStartDate}
												trialEndDate={org.trialEndDate}
											/>
										</div>
									</TableCell>
									<TableCell>
										{org.devPlan !== "none" ? (
											<Badge variant={getDevPlanBadgeVariant(org.devPlan)}>
												{org.devPlan}
											</Badge>
										) : (
											<span className="text-muted-foreground">—</span>
										)}
									</TableCell>
									<TableCell className="tabular-nums">
										{currencyFormatter.format(parseFloat(org.credits))}
									</TableCell>
									<TableCell className="tabular-nums text-muted-foreground">
										{currencyFormatter.format(
											parseFloat(org.totalCreditsAllTime ?? "0"),
										)}
									</TableCell>
									<TableCell className="tabular-nums text-muted-foreground">
										{currencyFormatter.format(
											parseFloat(org.totalSpent ?? "0"),
										)}
										{parseFloat(org.totalApiKeysSpent ?? "0") > 0 && (
											<p className="text-xs">
												{currencyFormatter.format(
													parseFloat(org.totalCreditsSpent ?? "0"),
												)}{" "}
												credits •{" "}
												{currencyFormatter.format(
													parseFloat(org.totalApiKeysSpent ?? "0"),
												)}{" "}
												BYOK
											</p>
										)}
									</TableCell>
									<TableCell className="tabular-nums text-muted-foreground">
										{numberFormatter.format(org.totalRequests ?? 0)}
									</TableCell>
									<TableCell
										className="tabular-nums text-muted-foreground"
										title={numberFormatter.format(org.totalTokens ?? 0)}
									>
										{compactNumberFormatter.format(org.totalTokens ?? 0)}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{formatDate(org.createdAt)}
									</TableCell>
									<TableCell>
										<div className="flex flex-wrap items-center gap-1">
											<Badge
												variant={
													org.status === "active" ? "secondary" : "outline"
												}
											>
												{org.status ?? "active"}
											</Badge>
											{org.riskFlagged && (
												<Badge variant="destructive">high risk</Badge>
											)}
										</div>
									</TableCell>
									<TableCell>
										<div className="flex items-center gap-1">
											<OrgStatusToggleButton
												orgId={org.id}
												orgName={org.name}
												currentStatus={org.status}
												disableBlockedReason={getOrgDeletionBlockedReason(
													org.credits,
												)}
												onToggle={handleToggleOrgStatus}
											/>
											<BlockOrgButton
												orgId={org.id}
												orgName={org.name}
												disabled={
													getOrgDeletionBlockedReason(org.credits) !== null
												}
												disabledReason={
													getOrgDeletionBlockedReason(org.credits) ?? undefined
												}
												onBlock={handleBlockOrganization}
											/>
										</div>
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			{totalPages > 1 && (
				<div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
					<p className="text-sm text-muted-foreground">
						Showing {offset + 1} to {Math.min(offset + limit, data.total)} of{" "}
						{data.total}
					</p>
					<div className="flex items-center gap-2">
						<Button variant="outline" size="sm" asChild disabled={page <= 1}>
							<Link
								href={buildOrganizationsHref({
									page: page - 1,
									sortBy,
									sortOrder,
									search,
									dateRange,
								})}
								className={page <= 1 ? "pointer-events-none opacity-50" : ""}
							>
								<ChevronLeft className="h-4 w-4" />
								Previous
							</Link>
						</Button>
						<span className="text-sm text-muted-foreground">
							Page {page} of {totalPages}
						</span>
						<Button
							variant="outline"
							size="sm"
							asChild
							disabled={page >= totalPages}
						>
							<Link
								href={buildOrganizationsHref({
									page: page + 1,
									sortBy,
									sortOrder,
									search,
									dateRange,
								})}
								className={
									page >= totalPages ? "pointer-events-none opacity-50" : ""
								}
							>
								Next
								<ChevronRight className="h-4 w-4" />
							</Link>
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}
