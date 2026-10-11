import Link from "next/link";
import { Suspense } from "react";

import { CatalogFiltersBar } from "@/components/catalog-filters";
import { CatalogSearch } from "@/components/catalog-search";
import {
	FilterNavigationProvider,
	FilterNavigationResults,
} from "@/components/filter-navigation";
import { MappingsTable } from "@/components/mappings-table";
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

type MappingSortBy =
	| "providerId"
	| "modelId"
	| "logsCount"
	| "errorsCount"
	| "clientErrorsCount"
	| "gatewayErrorsCount"
	| "upstreamErrorsCount"
	| "cost"
	| "avgTimeToFirstToken"
	| "throughput"
	| "updatedAt";

type SortOrder = "asc" | "desc";

const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 4,
});

export default async function ModelProviderMappingsPage({
	searchParams,
}: {
	searchParams?: Promise<Partial<Record<string, string>>>;
}) {
	await requireSession();

	const params = await searchParams;
	const search = params?.search ?? "";
	const sortBy = (params?.sortBy as MappingSortBy) ?? "logsCount";
	const sortOrder = (params?.sortOrder as SortOrder) ?? "desc";
	const pageWindow = parsePageWindow(
		params?.window,
		CATALOG_PAGE_WINDOW_DEFAULT,
	);
	const usageMode = parseUsageMode(params?.mode);
	const { from, to } = windowToFromTo(pageWindow);
	const filters = parseCatalogFilters(params);
	const selection = {
		search,
		providerId: params?.providerId,
		modelId: params?.modelId,
	};
	const filterQuery =
		catalogFilterQuery(filters) + catalogExactQuery(selection);

	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/model-provider-mappings", {
		params: {
			query: {
				search,
				providerId: selection.providerId,
				modelId: selection.modelId,
				sortBy,
				sortOrder,
				limit: 500,
				offset: 0,
				from,
				to,
				mode: usageMode,
				...filters,
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

	return (
		<FilterNavigationProvider>
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
					<Suspense>
						<CatalogSearch scope="mappings" selection={selection} />
					</Suspense>
				</header>

				<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
					<FilterNavigationResults message={null}>
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
								<TokenBreakdown breakdown={data} short className="mt-0.5" />
							</div>
							<div>
								<span className="text-muted-foreground">Total Cost</span>
								<p className="text-xl font-semibold tabular-nums">
									{currencyFormatter.format(totalCost)}
								</p>
							</div>
						</div>
					</FilterNavigationResults>
					<Suspense>
						<div className="flex flex-wrap items-center gap-2">
							<UsageModeSelector compact />
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
						<MappingsTable
							mappings={data.mappings}
							sortBy={sortBy}
							sortOrder={sortOrder}
							search={search}
							pageWindow={pageWindow}
							usageMode={usageMode}
							filterQuery={filterQuery}
						/>
					</div>
				</FilterNavigationResults>
			</div>
		</FilterNavigationProvider>
	);
}
