import { Search } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { MappingsTable } from "@/components/mappings-table";
import { TimeWindowSelector } from "@/components/time-window-selector";
import { Button } from "@/components/ui/button";
import {
	pageWindowOptionsWithMinutes,
	parsePageWindow,
	windowToFromTo,
} from "@/lib/page-window";
import { requireSession } from "@/lib/require-session";
import { createServerApiClient } from "@/lib/server-api";

type MappingSortBy =
	| "providerId"
	| "modelId"
	| "logsCount"
	| "errorsCount"
	| "clientErrorsCount"
	| "gatewayErrorsCount"
	| "upstreamErrorsCount"
	| "avgTimeToFirstToken"
	| "updatedAt";

type SortOrder = "asc" | "desc";

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

export default async function ModelProviderMappingsPage({
	searchParams,
}: {
	searchParams?: Promise<{
		search?: string;
		sortBy?: string;
		sortOrder?: string;
		window?: string;
	}>;
}) {
	await requireSession();

	const params = await searchParams;
	const search = params?.search ?? "";
	const sortBy = (params?.sortBy as MappingSortBy) ?? "logsCount";
	const sortOrder = (params?.sortOrder as SortOrder) ?? "desc";
	const pageWindow = parsePageWindow(params?.window);
	const { from, to } = windowToFromTo(pageWindow);

	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/model-provider-mappings", {
		params: {
			query: {
				search,
				sortBy,
				sortOrder,
				limit: 500,
				offset: 0,
				from,
				to,
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

	const totalTokens = data.totalTokens;
	const totalCost = data.totalCost;
	const totalRequests = data.totalRequests;

	async function handleSearch(formData: FormData) {
		"use server";
		const searchValue = formData.get("search") as string;
		const windowValue = formData.get("window") as string;
		const searchParam = searchValue
			? `&search=${encodeURIComponent(searchValue)}`
			: "";
		const windowParam = windowValue ? `&window=${windowValue}` : "";
		redirect(
			`/model-provider-mappings?sortBy=${sortBy}&sortOrder=${sortOrder}${searchParam}${windowParam}`,
		);
	}

	return (
		<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 overflow-hidden px-4 py-8 md:px-8">
			<header className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
				<div>
					<h1 className="text-3xl font-semibold tracking-tight">
						Model-Provider Mappings
					</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						{data.total} mappings — all models available per provider
					</p>
				</div>
				<form
					action={handleSearch}
					className="flex w-full items-center gap-2 sm:w-auto"
				>
					<input type="hidden" name="sortBy" value={sortBy} />
					<input type="hidden" name="sortOrder" value={sortOrder} />
					<input type="hidden" name="window" value={pageWindow} />
					<div className="relative flex-1 sm:flex-initial">
						<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
						<input
							type="text"
							name="search"
							placeholder="Search by model or provider..."
							defaultValue={search}
							className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:w-64"
						/>
					</div>
					<Button type="submit" size="sm">
						Search
					</Button>
				</form>
			</header>

			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex flex-wrap items-center gap-6 text-sm">
					<div>
						<span className="text-muted-foreground">Total Requests</span>
						<p className="text-xl font-semibold tabular-nums">
							{formatCompactNumber(totalRequests)}
						</p>
					</div>
					<div>
						<span className="text-muted-foreground">Total Tokens</span>
						<p className="text-xl font-semibold tabular-nums">
							{formatCompactNumber(totalTokens)}
						</p>
					</div>
					<div>
						<span className="text-muted-foreground">Total Cost</span>
						<p className="text-xl font-semibold tabular-nums">
							{currencyFormatter.format(totalCost)}
						</p>
					</div>
				</div>
				<Suspense>
					<TimeWindowSelector
						current={pageWindow}
						options={pageWindowOptionsWithMinutes}
					/>
				</Suspense>
			</div>

			<div className="min-w-0 overflow-x-auto rounded-lg border border-border/60 bg-card">
				<MappingsTable
					mappings={data.mappings}
					sortBy={sortBy}
					sortOrder={sortOrder}
					search={search}
					pageWindow={pageWindow}
				/>
			</div>
		</div>
	);
}
