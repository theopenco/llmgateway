import { Suspense } from "react";

import { CatalogFiltersBar } from "@/components/catalog-filters";
import {
	FilterNavigationProvider,
	FilterNavigationResults,
} from "@/components/filter-navigation";
import { ProvidersTable } from "@/components/providers-table";
import { SignInPrompt } from "@/components/sign-in-prompt";
import { TimeWindowSelector } from "@/components/time-window-selector";
import { TokenBreakdown } from "@/components/token-breakdown";
import { UsageModeSelector } from "@/components/usage-mode-selector";
import { catalogFilterQuery, parseCatalogFilters } from "@/lib/catalog-filters";
import {
	CATALOG_PAGE_WINDOW_DEFAULT,
	pageWindowOptionsWithMinutes,
	parsePageWindow,
	windowToFromTo,
} from "@/lib/page-window";
import { createServerApiClient } from "@/lib/server-api";
import { CATALOG_USAGE_MODE_DEFAULT, parseUsageMode } from "@/lib/usage-mode";

import { formatCompactNumber } from "@llmgateway/shared/number-format";

import type { paths } from "@/lib/api/v1";

type ProviderSortBy = NonNullable<
	NonNullable<paths["/admin/providers"]["get"]["parameters"]["query"]>["sortBy"]
>;
type SortOrder = "asc" | "desc";

const PROVIDER_SORT_KEYS: readonly ProviderSortBy[] = [
	"name",
	"status",
	"logsCount",
	"errorsCount",
	"clientErrorsCount",
	"cachedCount",
	"totalCost",
	"avgTimeToFirstToken",
	"throughput",
	"modelCount",
	"updatedAt",
];

function parseProviderSortBy(value: string | undefined): ProviderSortBy {
	return PROVIDER_SORT_KEYS.find((key) => key === value) ?? "logsCount";
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 4,
});

export default async function ProvidersPage({
	searchParams,
}: {
	searchParams?: Promise<Partial<Record<string, string>>>;
}) {
	const params = await searchParams;
	const sortBy = parseProviderSortBy(params?.sortBy);
	const sortOrder: SortOrder = params?.sortOrder === "asc" ? "asc" : "desc";
	const pageWindow = parsePageWindow(
		params?.window,
		CATALOG_PAGE_WINDOW_DEFAULT,
	);
	const usageMode = parseUsageMode(params?.mode, CATALOG_USAGE_MODE_DEFAULT);
	const { from, to } = windowToFromTo(pageWindow);
	const filters = parseCatalogFilters(params);

	const $api = await createServerApiClient();
	const { data, response } = await $api.GET("/admin/providers", {
		params: {
			query: { sortBy, sortOrder, from, to, mode: usageMode, ...filters },
		},
	});

	if (!data) {
		if (response.status === 401 || response.status === 403) {
			return <SignInPrompt />;
		}
		return (
			<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
				<p className="text-muted-foreground">
					Failed to load providers. Please try again later.
				</p>
			</div>
		);
	}

	return (
		<FilterNavigationProvider>
			<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 overflow-hidden px-4 py-8 md:px-8">
				<header className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
					<div>
						<h1 className="text-3xl font-semibold tracking-tight">Providers</h1>
						<p className="mt-1 text-sm text-muted-foreground">
							{data.total} providers — click a row to view history
						</p>
					</div>
				</header>

				<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
					<FilterNavigationResults message={null}>
						<div className="flex flex-wrap items-center gap-6 text-sm">
							<div>
								<span className="text-muted-foreground">Total Requests</span>
								<p className="text-xl font-semibold tabular-nums">
									{formatCompactNumber(
										data.providers.reduce((s, p) => s + p.logsCount, 0),
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
							<UsageModeSelector
								compact
								defaultMode={CATALOG_USAGE_MODE_DEFAULT}
							/>
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
						<ProvidersTable
							providers={data.providers}
							sortBy={sortBy}
							sortOrder={sortOrder}
							pageWindow={pageWindow}
							usageMode={usageMode}
							filterQuery={catalogFilterQuery(filters)}
						/>
					</div>
				</FilterNavigationResults>
			</div>
		</FilterNavigationProvider>
	);
}
