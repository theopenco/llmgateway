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
import { getOrganizations } from "@/lib/admin-organizations";
import { cn } from "@/lib/utils";

type SortBy =
	| "name"
	| "billingEmail"
	| "plan"
	| "devPlan"
	| "credits"
	| "createdAt"
	| "status"
	| "totalCreditsAllTime"
	| "totalSpent";
type SortOrder = "asc" | "desc";

function SortableHeader({
	label,
	sortKey,
	currentSortBy,
	currentSortOrder,
	search,
}: {
	label: string;
	sortKey: SortBy;
	currentSortBy: SortBy;
	currentSortOrder: SortOrder;
	search: string;
}) {
	const isActive = currentSortBy === sortKey;
	const nextOrder = isActive && currentSortOrder === "asc" ? "desc" : "asc";

	const searchParam = search ? `&search=${encodeURIComponent(search)}` : "";
	const href = `/organizations?page=1&sortBy=${sortKey}&sortOrder=${nextOrder}${searchParam}`;

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

function formatDate(dateString: string) {
	return new Date(dateString).toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
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
	}>;
}) {
	const params = await searchParams;
	const page = Math.max(1, parseInt(params?.page ?? "1", 10));
	const search = params?.search ?? "";
	const sortBy = (params?.sortBy as SortBy) || "createdAt";
	const sortOrder = (params?.sortOrder as SortOrder) || "desc";
	const limit = 25;
	const offset = (page - 1) * limit;

	const data = await getOrganizations({
		limit,
		offset,
		search,
		sortBy,
		sortOrder,
	});

	if (!data) {
		return <SignInPrompt />;
	}

	const totalPages = Math.ceil(data.total / limit);

	async function handleSearch(formData: FormData) {
		"use server";
		const searchValue = formData.get("search") as string;
		const sortByValue = formData.get("sortBy") as string;
		const sortOrderValue = formData.get("sortOrder") as string;
		const searchParam = searchValue
			? `&search=${encodeURIComponent(searchValue)}`
			: "";
		const sortParam = `&sortBy=${sortByValue}&sortOrder=${sortOrderValue}`;
		redirect(`/organizations?page=1${searchParam}${sortParam}`);
	}

	return (
		<div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 md:px-8">
			<header className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
				<div>
					<h1 className="text-3xl font-semibold tracking-tight">
						Organizations
					</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						{data.total} organizations found • Total credits:{" "}
						{currencyFormatter.format(parseFloat(data.totalCredits))}
					</p>
				</div>
				<form action={handleSearch} className="flex items-center gap-2">
					<input type="hidden" name="sortBy" value={sortBy} />
					<input type="hidden" name="sortOrder" value={sortOrder} />
					<div className="relative">
						<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
						<input
							type="text"
							name="search"
							placeholder="Search by name, email, or ID..."
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
									label="Organization"
									sortKey="name"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									search={search}
								/>
							</TableHead>
							<TableHead>
								<SortableHeader
									label="Email"
									sortKey="billingEmail"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									search={search}
								/>
							</TableHead>
							<TableHead>
								<SortableHeader
									label="Plan"
									sortKey="plan"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									search={search}
								/>
							</TableHead>
							<TableHead>
								<SortableHeader
									label="Dev Plan"
									sortKey="devPlan"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									search={search}
								/>
							</TableHead>
							<TableHead>
								<SortableHeader
									label="Credits"
									sortKey="credits"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									search={search}
								/>
							</TableHead>
							<TableHead>
								<SortableHeader
									label="All Time Credits"
									sortKey="totalCreditsAllTime"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									search={search}
								/>
							</TableHead>
							<TableHead>
								<SortableHeader
									label="Total Spent"
									sortKey="totalSpent"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									search={search}
								/>
							</TableHead>
							<TableHead>
								<SortableHeader
									label="Created"
									sortKey="createdAt"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									search={search}
								/>
							</TableHead>
							<TableHead>
								<SortableHeader
									label="Status"
									sortKey="status"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									search={search}
								/>
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.organizations.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={9}
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
										<Badge variant={getPlanBadgeVariant(org.plan)}>
											{org.plan}
										</Badge>
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
									</TableCell>
									<TableCell className="text-muted-foreground">
										{formatDate(org.createdAt)}
									</TableCell>
									<TableCell>
										<Badge
											variant={
												org.status === "active" ? "secondary" : "outline"
											}
										>
											{org.status ?? "active"}
										</Badge>
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
								href={`/organizations?page=${page - 1}${search ? `&search=${encodeURIComponent(search)}` : ""}&sortBy=${sortBy}&sortOrder=${sortOrder}`}
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
								href={`/organizations?page=${page + 1}${search ? `&search=${encodeURIComponent(search)}` : ""}&sortBy=${sortBy}&sortOrder=${sortOrder}`}
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
