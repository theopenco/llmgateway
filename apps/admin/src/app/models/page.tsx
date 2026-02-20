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
import { getModels } from "@/lib/admin-models";
import { cn } from "@/lib/utils";

import type { ModelSortBy } from "@/lib/admin-models";

type SortOrder = "asc" | "desc";

function SortableHeader({
	label,
	sortKey,
	currentSortBy,
	currentSortOrder,
	search,
}: {
	label: string;
	sortKey: ModelSortBy;
	currentSortBy: ModelSortBy;
	currentSortOrder: SortOrder;
	search: string;
}) {
	const isActive = currentSortBy === sortKey;
	const nextOrder = isActive && currentSortOrder === "asc" ? "desc" : "asc";

	const searchParam = search ? `&search=${encodeURIComponent(search)}` : "";
	const href = `/models?page=1&sortBy=${sortKey}&sortOrder=${nextOrder}${searchParam}`;

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

function formatNumber(n: number) {
	return new Intl.NumberFormat("en-US").format(n);
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

export default async function ModelsPage({
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
	const sortBy = (params?.sortBy as ModelSortBy) ?? "logsCount";
	const sortOrder = (params?.sortOrder as SortOrder) || "desc";
	const limit = 50;
	const offset = (page - 1) * limit;

	const data = await getModels({
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
		redirect(`/models?page=1${searchParam}${sortParam}`);
	}

	return (
		<div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 md:px-8">
			<header className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
				<div>
					<h1 className="text-3xl font-semibold tracking-tight">Models</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						{data.total} models found
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
							placeholder="Search by name or ID..."
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
									label="Model"
									sortKey="name"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									search={search}
								/>
							</TableHead>
							<TableHead>
								<SortableHeader
									label="Family"
									sortKey="family"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									search={search}
								/>
							</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>Free</TableHead>
							<TableHead>
								<SortableHeader
									label="Providers"
									sortKey="providerCount"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									search={search}
								/>
							</TableHead>
							<TableHead>
								<SortableHeader
									label="Requests"
									sortKey="logsCount"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									search={search}
								/>
							</TableHead>
							<TableHead>
								<SortableHeader
									label="Errors"
									sortKey="errorsCount"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									search={search}
								/>
							</TableHead>
							<TableHead>Error Rate</TableHead>
							<TableHead>
								<SortableHeader
									label="Cached"
									sortKey="cachedCount"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									search={search}
								/>
							</TableHead>
							<TableHead>
								<SortableHeader
									label="Avg TTFT"
									sortKey="avgTimeToFirstToken"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									search={search}
								/>
							</TableHead>
							<TableHead>Last Updated</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.models.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={11}
									className="h-24 text-center text-muted-foreground"
								>
									No models found
								</TableCell>
							</TableRow>
						) : (
							data.models.map((m) => {
								const errorRate =
									m.logsCount > 0
										? ((m.errorsCount / m.logsCount) * 100).toFixed(1)
										: "0.0";

								return (
									<TableRow key={m.id}>
										<TableCell>
											<span className="font-medium">
												{m.name !== m.id ? m.name : m.id}
											</span>
											{m.name !== m.id && (
												<p className="text-xs text-muted-foreground">{m.id}</p>
											)}
										</TableCell>
										<TableCell>
											<Badge variant="outline">{m.family}</Badge>
										</TableCell>
										<TableCell>
											<Badge
												variant={
													m.status === "active" ? "secondary" : "outline"
												}
											>
												{m.status}
											</Badge>
										</TableCell>
										<TableCell>
											{m.free ? (
												<Badge variant="default">Free</Badge>
											) : (
												<span className="text-muted-foreground">
													{"\u2014"}
												</span>
											)}
										</TableCell>
										<TableCell className="tabular-nums">
											{m.providerCount}
										</TableCell>
										<TableCell className="tabular-nums">
											{formatNumber(m.logsCount)}
										</TableCell>
										<TableCell className="tabular-nums">
											{formatNumber(m.errorsCount)}
										</TableCell>
										<TableCell className="tabular-nums">{errorRate}%</TableCell>
										<TableCell className="tabular-nums">
											{formatNumber(m.cachedCount)}
										</TableCell>
										<TableCell className="tabular-nums">
											{m.avgTimeToFirstToken !== null
												? `${Math.round(m.avgTimeToFirstToken)}ms`
												: "\u2014"}
										</TableCell>
										<TableCell className="text-muted-foreground">
											{formatDate(m.updatedAt)}
										</TableCell>
									</TableRow>
								);
							})
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
								href={`/models?page=${page - 1}${search ? `&search=${encodeURIComponent(search)}` : ""}&sortBy=${sortBy}&sortOrder=${sortOrder}`}
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
								href={`/models?page=${page + 1}${search ? `&search=${encodeURIComponent(search)}` : ""}&sortBy=${sortBy}&sortOrder=${sortOrder}`}
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
