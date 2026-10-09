import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { CatalogFiltersBar } from "@/components/catalog-filters";
import { CatalogSearch } from "@/components/catalog-search";
import {
	FilterLink,
	FilterNavigationProvider,
	FilterNavigationResults,
} from "@/components/filter-navigation";
import { ModelsTable } from "@/components/models-table";
import { TimeWindowSelector } from "@/components/time-window-selector";
import { TokenBreakdown } from "@/components/token-breakdown";
import { Button } from "@/components/ui/button";
import { UsageModeSelector } from "@/components/usage-mode-selector";
import {
	catalogExactQuery,
	catalogFilterQuery,
	parseCatalogFilters,
} from "@/lib/catalog-filters";
import {
	CATALOG_PAGE_WINDOW_DEFAULT,
	pageWindowOptionsWithMinutes,
	parsePageWindow,
	windowToFromTo,
} from "@/lib/page-window";
import { requireSession } from "@/lib/require-session";
import { createServerApiClient } from "@/lib/server-api";
import { parseUsageMode } from "@/lib/usage-mode";

import { formatCompactNumber } from "@llmgateway/shared/number-format";

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

const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 4,
});

export default async function ModelsPage({
	searchParams,
}: {
	searchParams?: Promise<Partial<Record<string, string>>>;
}) {
	await requireSession();

	const params = await searchParams;
	const page = Math.max(1, parseInt(params?.page ?? "1", 10));
	const search = params?.search ?? "";
	const sortBy = (params?.sortBy as ModelSortBy) ?? "logsCount";
	const sortOrder = (params?.sortOrder as SortOrder) || "desc";
	const pageWindow = parsePageWindow(
		params?.window,
		CATALOG_PAGE_WINDOW_DEFAULT,
	);
	const usageMode = parseUsageMode(params?.mode);
	const { from, to } = windowToFromTo(pageWindow);
	const filters = parseCatalogFilters(params);
	const selection = {
		search,
		modelId: params?.modelId,
	};
	const filterQuery =
		catalogFilterQuery(filters) + catalogExactQuery(selection);
	const limit = 50;
	const offset = (page - 1) * limit;

	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/models", {
		params: {
			query: {
				limit,
				offset,
				search,
				modelId: selection.modelId,
				sortBy,
				sortOrder,
				from,
				to,
				mode: usageMode,
				...filters,
			},
		},
	});

	if (!data) {
		return <SignInPrompt />;
	}

	const totalPages = Math.ceil(data.total / limit);

	const modeParam = usageMode === "total" ? "" : `&mode=${usageMode}`;

	return (
		<FilterNavigationProvider>
			<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 overflow-hidden px-4 py-8 md:px-8">
				<header className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
					<div>
						<h1 className="text-3xl font-semibold tracking-tight">Models</h1>
						<p className="mt-1 text-sm text-muted-foreground">
							{data.total} models found — click a row to view details
						</p>
					</div>
					<div className="flex w-full items-center gap-3 sm:w-auto">
						<Suspense>
							<CatalogSearch scope="models" selection={selection} />
						</Suspense>
					</div>
				</header>

				<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
					<FilterNavigationResults message={null}>
						<div className="flex flex-wrap items-center gap-6 text-sm">
							<div>
								<span className="text-muted-foreground">
									Requests on this page
								</span>
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
								<TokenBreakdown breakdown={data} short className="mt-0.5" />
							</div>
							<div>
								<span className="text-muted-foreground">Total Cost</span>
								<p className="text-xl font-semibold tabular-nums">
									{currencyFormatter.format(data.totalCost)}
								</p>
							</div>
						</div>
					</FilterNavigationResults>
					<Suspense>
						<div className="flex flex-wrap items-center gap-2">
							<UsageModeSelector compact extraParams={{ page: null }} />
							<TimeWindowSelector
								current={pageWindow}
								options={pageWindowOptionsWithMinutes}
							/>
						</div>
					</Suspense>
				</div>

				<Suspense>
					<CatalogFiltersBar filters={filters} />
				</Suspense>

				<FilterNavigationResults>
					<div className="min-w-0 overflow-x-auto rounded-lg border border-border/60 bg-card">
						<ModelsTable
							models={data.models}
							sortBy={sortBy}
							sortOrder={sortOrder}
							search={search}
							pageWindow={pageWindow}
							usageMode={usageMode}
							filterQuery={filterQuery}
						/>
					</div>
				</FilterNavigationResults>

				{totalPages > 1 && (
					<div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
						<p className="text-sm text-muted-foreground">
							Showing {offset + 1} to {Math.min(offset + limit, data.total)} of{" "}
							{data.total}
						</p>
						<div className="flex items-center gap-2">
							<Button variant="outline" size="sm" asChild disabled={page <= 1}>
								<FilterLink
									href={`/models?page=${page - 1}${search ? `&search=${encodeURIComponent(search)}` : ""}&sortBy=${sortBy}&sortOrder=${sortOrder}&window=${pageWindow}${modeParam}${filterQuery}`}
									className={page <= 1 ? "pointer-events-none opacity-50" : ""}
								>
									<ChevronLeft className="h-4 w-4" />
									Previous
								</FilterLink>
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
								<FilterLink
									href={`/models?page=${page + 1}${search ? `&search=${encodeURIComponent(search)}` : ""}&sortBy=${sortBy}&sortOrder=${sortOrder}&window=${pageWindow}${modeParam}${filterQuery}`}
									className={
										page >= totalPages ? "pointer-events-none opacity-50" : ""
									}
								>
									Next
									<ChevronRight className="h-4 w-4" />
								</FilterLink>
							</Button>
						</div>
					</div>
				)}
			</div>
		</FilterNavigationProvider>
	);
}
