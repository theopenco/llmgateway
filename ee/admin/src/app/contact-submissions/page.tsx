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

type SortBy = "createdAt" | "name" | "email" | "spamFilterStatus";
type SortOrder = "asc" | "desc";
type Status = "pending" | "rejected" | "delivered" | "delivery_failed";

function SortableHeader({
	label,
	sortKey,
	currentSortBy,
	currentSortOrder,
	search,
	status,
}: {
	label: string;
	sortKey: SortBy;
	currentSortBy: SortBy;
	currentSortOrder: SortOrder;
	search: string;
	status: string;
}) {
	const isActive = currentSortBy === sortKey;
	const nextOrder = isActive && currentSortOrder === "asc" ? "desc" : "asc";

	const searchParam = search ? `&search=${encodeURIComponent(search)}` : "";
	const statusParam = status ? `&status=${encodeURIComponent(status)}` : "";
	const href = `/contact-submissions?page=1&sortBy=${sortKey}&sortOrder=${nextOrder}${searchParam}${statusParam}`;

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

function getStatusBadgeVariant(status: string) {
	switch (status) {
		case "delivered":
			return "default";
		case "rejected":
			return "destructive";
		case "delivery_failed":
			return "destructive";
		case "pending":
			return "secondary";
		default:
			return "outline";
	}
}

function getStatusLabel(status: string) {
	switch (status) {
		case "delivery_failed":
			return "Failed";
		default:
			return status.charAt(0).toUpperCase() + status.slice(1);
	}
}

const statusOptions: { value: Status | ""; label: string }[] = [
	{ value: "", label: "All" },
	{ value: "delivered", label: "Delivered" },
	{ value: "pending", label: "Pending" },
	{ value: "rejected", label: "Rejected" },
	{ value: "delivery_failed", label: "Failed" },
];

export default async function ContactSubmissionsPage({
	searchParams,
}: {
	searchParams?: Promise<{
		page?: string;
		search?: string;
		status?: string;
		sortBy?: string;
		sortOrder?: string;
	}>;
}) {
	await requireSession();

	const params = await searchParams;
	const page = Math.max(1, parseInt(params?.page ?? "1", 10));
	const search = params?.search ?? "";
	const status = (params?.status as Status) || "";
	const sortBy = (params?.sortBy as SortBy) || "createdAt";
	const sortOrder = (params?.sortOrder as SortOrder) || "desc";
	const limit = 25;
	const offset = (page - 1) * limit;

	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/contact-submissions", {
		params: {
			query: {
				limit,
				offset,
				search: search || undefined,
				status: (status as Status) || undefined,
				sortBy,
				sortOrder,
			},
		},
	});

	if (!data) {
		return (
			<div className="flex min-h-screen items-center justify-center px-4">
				<div className="w-full max-w-md text-center">
					<h1 className="text-3xl font-semibold tracking-tight">
						Admin Dashboard
					</h1>
					<p className="mt-2 text-sm text-muted-foreground">
						Sign in to access the admin dashboard
					</p>
					<Button asChild size="lg" className="mt-6 w-full">
						<Link href="/login">Sign In</Link>
					</Button>
				</div>
			</div>
		);
	}

	const totalPages = Math.ceil(data.total / limit);

	async function handleSearch(formData: FormData) {
		"use server";
		const searchValue = formData.get("search") as string;
		const statusValue = formData.get("status") as string;
		const sortByValue = formData.get("sortBy") as string;
		const sortOrderValue = formData.get("sortOrder") as string;
		const searchParam = searchValue
			? `&search=${encodeURIComponent(searchValue)}`
			: "";
		const statusParam = statusValue
			? `&status=${encodeURIComponent(statusValue)}`
			: "";
		const sortParam = `&sortBy=${sortByValue}&sortOrder=${sortOrderValue}`;
		redirect(
			`/contact-submissions?page=1${searchParam}${statusParam}${sortParam}`,
		);
	}

	return (
		<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
			<header className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
				<div>
					<h1 className="text-3xl font-semibold tracking-tight">
						Contact Submissions
					</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						{data.total} submissions found
					</p>
				</div>
				<form action={handleSearch} className="flex items-center gap-2">
					<input type="hidden" name="sortBy" value={sortBy} />
					<input type="hidden" name="sortOrder" value={sortOrder} />
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
					<div className="relative">
						<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
						<input
							type="text"
							name="search"
							placeholder="Search by name, email, or message..."
							defaultValue={search}
							className="h-9 w-64 rounded-md border border-border bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
						/>
					</div>
					<Button type="submit" size="sm">
						Search
					</Button>
				</form>
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
								/>
							</TableHead>
							<TableHead>
								<SortableHeader
									label="Name"
									sortKey="name"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									search={search}
									status={status}
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
								/>
							</TableHead>
							<TableHead>Country</TableHead>
							<TableHead>Size</TableHead>
							<TableHead>Message</TableHead>
							<TableHead>
								<SortableHeader
									label="Status"
									sortKey="spamFilterStatus"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									search={search}
									status={status}
								/>
							</TableHead>
							<TableHead>Reason</TableHead>
							<TableHead>IP</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.submissions.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={9}
									className="h-24 text-center text-muted-foreground"
								>
									No submissions found
								</TableCell>
							</TableRow>
						) : (
							data.submissions.map((submission) => (
								<TableRow
									key={submission.id}
									className="cursor-pointer hover:bg-muted/50"
								>
									<TableCell className="text-muted-foreground">
										{formatDate(submission.createdAt)}
									</TableCell>
									<TableCell className="font-medium">
										<Link
											href={`/contact-submissions/${submission.id}`}
											className="block hover:underline"
										>
											{submission.name}
										</Link>
									</TableCell>
									<TableCell className="text-muted-foreground">
										{submission.email}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{submission.country}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{submission.size}
									</TableCell>
									<TableCell
										className="max-w-xs truncate text-muted-foreground"
										title={submission.message}
									>
										{submission.message}
									</TableCell>
									<TableCell>
										<Badge
											variant={getStatusBadgeVariant(
												submission.spamFilterStatus,
											)}
										>
											{getStatusLabel(submission.spamFilterStatus)}
										</Badge>
									</TableCell>
									<TableCell className="text-xs text-muted-foreground">
										{submission.rejectionReason ?? "—"}
									</TableCell>
									<TableCell className="text-xs text-muted-foreground">
										{submission.ipAddress ?? "—"}
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			{totalPages > 1 && (
				<div className="flex items-center justify-between">
					<p className="text-sm text-muted-foreground">
						Showing {offset + 1} to {Math.min(offset + limit, data.total)} of{" "}
						{data.total}
					</p>
					<div className="flex items-center gap-2">
						<Button variant="outline" size="sm" asChild disabled={page <= 1}>
							<Link
								href={`/contact-submissions?page=${page - 1}${search ? `&search=${encodeURIComponent(search)}` : ""}${status ? `&status=${status}` : ""}&sortBy=${sortBy}&sortOrder=${sortOrder}`}
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
								href={`/contact-submissions?page=${page + 1}${search ? `&search=${encodeURIComponent(search)}` : ""}${status ? `&status=${status}` : ""}&sortBy=${sortBy}&sortOrder=${sortOrder}`}
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
