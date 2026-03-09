import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { DateRangePicker } from "@/components/date-range-picker";
import { ModelsTable } from "@/components/models-table";
import { Button } from "@/components/ui/button";
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

export default async function ModelsPage({
	searchParams,
}: {
	searchParams?: Promise<{
		page?: string;
		search?: string;
		sortBy?: string;
		sortOrder?: string;
		from?: string;
		to?: string;
	}>;
}) {
	const params = await searchParams;
	const page = Math.max(1, parseInt(params?.page ?? "1", 10));
	const search = params?.search ?? "";
	const sortBy = (params?.sortBy as ModelSortBy) ?? "logsCount";
	const sortOrder = (params?.sortOrder as SortOrder) || "desc";
	const from = params?.from;
	const to = params?.to;
	const limit = 50;
	const offset = (page - 1) * limit;

	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/models", {
		params: { query: { limit, offset, search, sortBy, sortOrder, from, to } },
	});

	if (!data) {
		return <SignInPrompt />;
	}

	const totalPages = Math.ceil(data.total / limit);
	const dateParams = from && to ? `&from=${from}&to=${to}` : "";

	async function handleSearch(formData: FormData) {
		"use server";
		const searchValue = formData.get("search") as string;
		const sortByValue = formData.get("sortBy") as string;
		const sortOrderValue = formData.get("sortOrder") as string;
		const fromValue = formData.get("from") as string;
		const toValue = formData.get("to") as string;
		const searchParam = searchValue
			? `&search=${encodeURIComponent(searchValue)}`
			: "";
		const sortParam = `&sortBy=${sortByValue}&sortOrder=${sortOrderValue}`;
		const datePart =
			fromValue && toValue ? `&from=${fromValue}&to=${toValue}` : "";
		redirect(`/models?page=1${searchParam}${sortParam}${datePart}`);
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
						<input type="hidden" name="from" value={from ?? ""} />
						<input type="hidden" name="to" value={to ?? ""} />
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
					<Suspense>
						<DateRangePicker />
					</Suspense>
				</div>
			</header>

			<div className="min-w-0 overflow-x-auto rounded-lg border border-border/60 bg-card">
				<ModelsTable
					models={data.models}
					sortBy={sortBy}
					sortOrder={sortOrder}
					search={search}
					from={from}
					to={to}
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
								href={`/models?page=${page - 1}${search ? `&search=${encodeURIComponent(search)}` : ""}&sortBy=${sortBy}&sortOrder=${sortOrder}${dateParams}`}
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
								href={`/models?page=${page + 1}${search ? `&search=${encodeURIComponent(search)}` : ""}&sortBy=${sortBy}&sortOrder=${sortOrder}${dateParams}`}
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
