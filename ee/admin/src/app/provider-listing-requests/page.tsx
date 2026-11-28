import {
	ArrowDown,
	ArrowUp,
	ArrowUpDown,
	ChevronLeft,
	ChevronRight,
	Search,
} from "lucide-react";
import Link from "next/link";

import { SearchForm } from "@/components/search-form";
import { SignInPrompt } from "@/components/sign-in-prompt";
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
import { requireSession } from "@/lib/require-session";
import { createServerApiClient } from "@/lib/server-api";
import { cn } from "@/lib/utils";

import {
	getPaymentBadgeVariant,
	getStatusBadgeVariant,
	getStatusLabel,
} from "./status";

const SORT_BY_VALUES = [
	"createdAt",
	"providerName",
	"email",
	"spamFilterStatus",
] as const;
const STATUS_VALUES = [
	"pending",
	"rejected",
	"delivered",
	"delivery_failed",
] as const;

type SortBy = (typeof SORT_BY_VALUES)[number];
type SortOrder = "asc" | "desc";
type Status = (typeof STATUS_VALUES)[number];

function isSortBy(value: string | undefined): value is SortBy {
	return SORT_BY_VALUES.some((v) => v === value);
}

function isStatus(value: string | undefined): value is Status {
	return STATUS_VALUES.some((v) => v === value);
}

function SortableHeader({
	label,
	sortKey,
	currentSortBy,
	currentSortOrder,
	search,
	status,
	archived,
}: {
	label: string;
	sortKey: SortBy;
	currentSortBy: SortBy;
	currentSortOrder: SortOrder;
	search: string;
	status: string;
	archived: boolean;
}) {
	const isActive = currentSortBy === sortKey;
	const nextOrder = isActive && currentSortOrder === "asc" ? "desc" : "asc";

	const searchParam = search ? `&search=${encodeURIComponent(search)}` : "";
	const statusParam = status ? `&status=${encodeURIComponent(status)}` : "";
	const archivedParam = archived ? "&archived=true" : "";
	const href = `/provider-listing-requests?page=1&sortBy=${sortKey}&sortOrder=${nextOrder}${searchParam}${statusParam}${archivedParam}`;

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

function formatDate(dateString: string) {
	return new Date(dateString).toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

const statusOptions: { value: Status | ""; label: string }[] = [
	{ value: "", label: "All" },
	{ value: "delivered", label: "Delivered" },
	{ value: "pending", label: "Pending" },
	{ value: "rejected", label: "Rejected" },
	{ value: "delivery_failed", label: "Failed" },
];

export default async function ProviderListingRequestsPage({
	searchParams,
}: {
	searchParams?: Promise<{
		page?: string;
		search?: string;
		status?: string;
		sortBy?: string;
		sortOrder?: string;
		archived?: string;
	}>;
}) {
	await requireSession();

	const params = await searchParams;
	const parsedPage = parseInt(params?.page ?? "1", 10);
	const page = Number.isNaN(parsedPage) ? 1 : Math.max(1, parsedPage);
	const search = params?.search ?? "";
	const status: Status | "" = isStatus(params?.status) ? params.status : "";
	const sortBy: SortBy = isSortBy(params?.sortBy) ? params.sortBy : "createdAt";
	const sortOrder: SortOrder = params?.sortOrder === "asc" ? "asc" : "desc";
	const archived = params?.archived === "true";
	const limit = 25;
	const offset = (page - 1) * limit;

	const $api = await createServerApiClient();
	const { data, response } = await $api.GET(
		"/admin/provider-listing-requests",
		{
			params: {
				query: {
					limit,
					offset,
					search: search || undefined,
					status: status || undefined,
					archived: archived ? "true" : "false",
					sortBy,
					sortOrder,
				},
			},
		},
	);

	if (!data) {
		if (response.status === 401) {
			return <SignInPrompt />;
		}
		return (
			<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
				<p className="text-muted-foreground">
					Failed to load requests. Please try again later.
				</p>
			</div>
		);
	}

	const totalPages = Math.ceil(data.total / limit);

	return (
		<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
			<header className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
				<div>
					<h1 className="text-3xl font-semibold tracking-tight">
						Provider Requests
					</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						{data.total} requests found
					</p>
				</div>
				<SearchForm
					pathname="/provider-listing-requests"
					params={[
						{ name: "page", value: "1" },
						{ name: "search" },
						{ name: "status" },
						{ name: "sortBy", value: sortBy },
						{ name: "sortOrder", value: sortOrder },
						...(archived ? [{ name: "archived", value: "true" }] : []),
					]}
					className="flex w-full flex-wrap items-center gap-2 sm:w-auto"
				>
					<select
						name="status"
						defaultValue={status}
						className="h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
					>
						{statusOptions.map((opt) => (
							<option key={opt.value} value={opt.value}>
								{opt.label}
							</option>
						))}
					</select>
					<div className="relative min-w-0 flex-1 sm:max-w-64">
						<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
						<input
							type="text"
							name="search"
							placeholder="Search by provider, email, URL, or country..."
							defaultValue={search}
							className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
						/>
					</div>
					<Button type="submit" size="sm">
						Search
					</Button>
					<Button variant={archived ? "default" : "outline"} size="sm" asChild>
						<Link
							href={`/provider-listing-requests?page=1${search ? `&search=${encodeURIComponent(search)}` : ""}${status ? `&status=${status}` : ""}&sortBy=${sortBy}&sortOrder=${sortOrder}${archived ? "" : "&archived=true"}`}
						>
							Archived
						</Link>
					</Button>
				</SearchForm>
			</header>

			<div className="overflow-x-auto rounded-lg border border-border/60 bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>
								<SortableHeader
									label="Date"
									sortKey="createdAt"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									search={search}
									status={status}
									archived={archived}
								/>
							</TableHead>
							<TableHead>
								<SortableHeader
									label="Provider"
									sortKey="providerName"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									search={search}
									status={status}
									archived={archived}
								/>
							</TableHead>
							<TableHead>
								<SortableHeader
									label="Email"
									sortKey="email"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									search={search}
									status={status}
									archived={archived}
								/>
							</TableHead>
							<TableHead>Country</TableHead>
							<TableHead>Retention</TableHead>
							<TableHead>Trains</TableHead>
							<TableHead>Fee</TableHead>
							<TableHead>
								<SortableHeader
									label="Status"
									sortKey="spamFilterStatus"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									search={search}
									status={status}
									archived={archived}
								/>
							</TableHead>
							<TableHead>IP</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.requests.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={9}
									className="h-24 text-center text-muted-foreground"
								>
									No requests found
								</TableCell>
							</TableRow>
						) : (
							data.requests.map((request) => (
								<TableRow
									key={request.id}
									className="cursor-pointer hover:bg-muted/50"
								>
									<TableCell className="text-muted-foreground">
										{formatDate(request.createdAt)}
									</TableCell>
									<TableCell className="font-medium">
										<Link
											href={`/provider-listing-requests/${request.id}`}
											className="block hover:underline"
										>
											{request.providerName}
										</Link>
									</TableCell>
									<TableCell className="text-muted-foreground">
										{request.email}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{request.country}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{request.dataRetentionDays ?? 0}d
									</TableCell>
									<TableCell className="text-muted-foreground">
										{request.trainsOnData ? "Yes" : "No"}
									</TableCell>
									<TableCell>
										<Badge
											variant={getPaymentBadgeVariant(request.paymentStatus)}
										>
											{request.paymentStatus}
										</Badge>
									</TableCell>
									<TableCell>
										<Badge
											variant={getStatusBadgeVariant(request.spamFilterStatus)}
										>
											{getStatusLabel(request.spamFilterStatus)}
										</Badge>
									</TableCell>
									<TableCell className="text-xs text-muted-foreground">
										{request.ipAddress ?? "—"}
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
								href={`/provider-listing-requests?page=${page - 1}${search ? `&search=${encodeURIComponent(search)}` : ""}${status ? `&status=${status}` : ""}&sortBy=${sortBy}&sortOrder=${sortOrder}${archived ? "&archived=true" : ""}`}
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
								href={`/provider-listing-requests?page=${page + 1}${search ? `&search=${encodeURIComponent(search)}` : ""}${status ? `&status=${status}` : ""}&sortBy=${sortBy}&sortOrder=${sortOrder}${archived ? "&archived=true" : ""}`}
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
