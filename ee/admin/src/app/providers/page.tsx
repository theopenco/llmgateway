import Link from "next/link";
import { Suspense } from "react";

import { ProvidersTable } from "@/components/providers-table";
import { TimeWindowSelector } from "@/components/time-window-selector";
import { Button } from "@/components/ui/button";
import { parsePageWindow, windowToFromTo } from "@/lib/page-window";
import { createServerApiClient } from "@/lib/server-api";

import type { paths } from "@/lib/api/v1";

type ProviderSortBy = NonNullable<
	paths["/admin/providers"]["get"]["parameters"]["query"]
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

export default async function ProvidersPage({
	searchParams,
}: {
	searchParams?: Promise<{
		sortBy?: string;
		sortOrder?: string;
		window?: string;
	}>;
}) {
	const params = await searchParams;
	const sortBy = (params?.sortBy as ProviderSortBy) ?? "logsCount";
	const sortOrder = (params?.sortOrder as SortOrder) || "desc";
	const pageWindow = parsePageWindow(params?.window);
	const { from, to } = windowToFromTo(pageWindow);

	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/providers", {
		params: { query: { sortBy, sortOrder, from, to } },
	});

	if (!data) {
		return <SignInPrompt />;
	}

	return (
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
				<ProvidersTable
					providers={data.providers}
					sortBy={sortBy}
					sortOrder={sortOrder}
					pageWindow={pageWindow}
				/>
			</div>
		</div>
	);
}
