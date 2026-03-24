import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ModelsTable } from "@/components/models-table";
import { TimeWindowSelector } from "@/components/time-window-selector";
import { Button } from "@/components/ui/button";
import { parsePageWindow, windowToFromTo } from "@/lib/page-window";
import { createServerApiClient } from "@/lib/server-api";

import type { paths } from "@/lib/api/v1";

type ModelSortBy = NonNullable<
	paths["/admin/models"]["get"]["parameters"]["query"]
>["sortBy"];
type SortOrder = "asc" | "desc";

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

function formatCompactNumber(value: number): string {
	if (value >= 1_000_000_000) {
		return `${(value / 1_000_000_000).toFixed(1)}B`;
	}
	if (value >= 1_000_000) {
		return `${(value / 1_000_000).toFixed(1)}M`;
	}
	if (value >= 1_000) {
		return `${(value / 1_000).toFixed(1)}k`;
	}
	return value.toLocaleString("en-US");
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 4,
});

export default async function ModelsPage({
	searchParams,
}: {
	searchParams?: Promise<{
		page?: string;
		search?: string;
		sortBy?: string;
		sortOrder?: string;
		window?: string;
		projectId?: string;
	}>;
}) {
	const params = await searchParams;
	const page = Math.max(1, parseInt(params?.page ?? "1", 10));
	const search = params?.search ?? "";
	const sortBy = (params?.sortBy as ModelSortBy) ?? "logsCount";
	const sortOrder = (params?.sortOrder as SortOrder) || "desc";
	const pageWindow = parsePageWindow(params?.window);
	const { from, to } = windowToFromTo(pageWindow);
	const projectId = params?.projectId ?? "";
	const limit = 50;
	const offset = (page - 1) * limit;

	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/models", {
		params: {
			query: {
				limit,
				offset,
				search,
				sortBy,
				sortOrder,
				from,
				to,
				...(projectId ? { projectId } : {}),
			},
		},
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
		const windowValue = formData.get("window") as string;
		const projectIdValue = formData.get("projectId") as string;
		const searchParam = searchValue
			? `&search=${encodeURIComponent(searchValue)}`
			: "";
		const sortParam = `&sortBy=${sortByValue}&sortOrder=${sortOrderValue}`;
		const windowParam = windowValue ? `&window=${windowValue}` : "";
		const projectIdParam = projectIdValue
			? `&projectId=${encodeURIComponent(projectIdValue)}`
			: "";
		redirect(
			`/models?page=1${searchParam}${sortParam}${windowParam}${projectIdParam}`,
		);
	}

	return (
		<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 overflow-hidden px-4 py-8 md:px-8">
			<header className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
				<div>
					<h1 className="text-3xl font-semibold tracking-tight">Models</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						{data.total} models found — click a row to view details
					</p>
				</div>
				<div className="flex items-center gap-3">
					<form action={handleSearch} className="flex items-center gap-2">
						<input type="hidden" name="sortBy" value={sortBy} />
						<input type="hidden" name="sortOrder" value={sortOrder} />
						<input type="hidden" name="window" value={pageWindow} />
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
						<input
							type="text"
							name="projectId"
							placeholder="Filter by project ID..."
							defaultValue={projectId}
							className="h-9 w-52 rounded-md border border-border bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
						/>
						<Button type="submit" size="sm">
							Search
						</Button>
					</form>
				</div>
			</header>

			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex flex-wrap items-center gap-6 text-sm">
					<div>
						<span className="text-muted-foreground">Total Requests</span>
						<p className="text-xl font-semibold tabular-nums">
							{formatCompactNumber(
								data.models.reduce((s, m) => s + m.logsCount, 0),
							)}
						</p>
					</div>
					<div>
						<span className="text-muted-foreground">Total Tokens</span>
						<p className="text-xl font-semibold tabular-nums">
							{formatCompactNumber(data.totalTokens)}
						</p>
					</div>
					<div>
						<span className="text-muted-foreground">Total Cost</span>
						<p className="text-xl font-semibold tabular-nums">
							{currencyFormatter.format(data.totalCost)}
						</p>
					</div>
				</div>
				<Suspense>
					<TimeWindowSelector current={pageWindow} />
				</Suspense>
			</div>

			<div className="min-w-0 overflow-x-auto rounded-lg border border-border/60 bg-card">
				<ModelsTable
					models={data.models}
					sortBy={sortBy}
					sortOrder={sortOrder}
					search={search}
					pageWindow={pageWindow}
					projectId={projectId}
				/>
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
								href={`/models?page=${page - 1}${search ? `&search=${encodeURIComponent(search)}` : ""}&sortBy=${sortBy}&sortOrder=${sortOrder}&window=${pageWindow}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ""}`}
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
								href={`/models?page=${page + 1}${search ? `&search=${encodeURIComponent(search)}` : ""}&sortBy=${sortBy}&sortOrder=${sortOrder}&window=${pageWindow}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ""}`}
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
