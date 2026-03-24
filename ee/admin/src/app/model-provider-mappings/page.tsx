import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { TimeWindowSelector } from "@/components/time-window-selector";
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
import { parsePageWindow, windowToFromTo } from "@/lib/page-window";
import { createServerApiClient } from "@/lib/server-api";
import { cn } from "@/lib/utils";

import { getProviderIcon } from "@llmgateway/shared";

import type { ModelProviderMappingEntry } from "@/lib/types";

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

function SortableHeader({
	label,
	sortKey,
	currentSortBy,
	currentSortOrder,
	search,
	pageWindow,
}: {
	label: string;
	sortKey: MappingSortBy;
	currentSortBy: MappingSortBy;
	currentSortOrder: SortOrder;
	search: string;
	pageWindow: string;
}) {
	const isActive = currentSortBy === sortKey;
	const nextOrder = isActive && currentSortOrder === "asc" ? "desc" : "asc";
	const searchParam = search ? `&search=${encodeURIComponent(search)}` : "";
	const href = `/model-provider-mappings?sortBy=${sortKey}&sortOrder=${nextOrder}${searchParam}&window=${pageWindow}`;

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

function formatPrice(price: string | null) {
	if (!price) {
		return "\u2014";
	}
	const num = parseFloat(price);
	if (num === 0) {
		return "Free";
	}
	if (num < 0.001) {
		return `$${(num * 1_000_000).toFixed(2)}/M`;
	}
	return `$${num.toFixed(4)}`;
}

function MappingRow({ mapping }: { mapping: ModelProviderMappingEntry }) {
	const ProviderIcon = getProviderIcon(mapping.providerId);
	const errorRate =
		mapping.logsCount > 0
			? ((mapping.errorsCount / mapping.logsCount) * 100).toFixed(1)
			: "0.0";

	return (
		<TableRow>
			<TableCell>
				<div className="flex items-center gap-2">
					<ProviderIcon className="h-4 w-4 shrink-0 dark:text-white" />
					<div>
						<p className="text-xs text-muted-foreground">
							{mapping.providerId}
						</p>
						<span className="font-medium">{mapping.providerName}</span>
					</div>
				</div>
			</TableCell>
			<TableCell>
				<div>
					<Link
						href={`/models/${encodeURIComponent(mapping.modelId)}`}
						className="font-medium hover:underline"
					>
						{mapping.providerId}/{mapping.modelId}
					</Link>
					{mapping.modelName !== mapping.modelId && (
						<p className="text-xs text-muted-foreground">{mapping.modelName}</p>
					)}
				</div>
			</TableCell>
			<TableCell>
				<Badge variant={mapping.status === "active" ? "secondary" : "outline"}>
					{mapping.status}
				</Badge>
			</TableCell>
			<TableCell className="tabular-nums">
				{formatNumber(mapping.logsCount)}
			</TableCell>
			<TableCell className="tabular-nums">
				{formatNumber(mapping.errorsCount)}
			</TableCell>
			<TableCell className="tabular-nums">
				{formatNumber(mapping.clientErrorsCount)}
			</TableCell>
			<TableCell className="tabular-nums">
				{formatNumber(mapping.gatewayErrorsCount)}
			</TableCell>
			<TableCell className="tabular-nums">
				{formatNumber(mapping.upstreamErrorsCount)}
			</TableCell>
			<TableCell className="tabular-nums">{errorRate}%</TableCell>
			<TableCell className="tabular-nums">
				{mapping.avgTimeToFirstToken !== null
					? `${Math.round(mapping.avgTimeToFirstToken)}ms`
					: "\u2014"}
			</TableCell>
			<TableCell className="tabular-nums text-xs">
				{formatPrice(mapping.inputPrice)}
			</TableCell>
			<TableCell className="tabular-nums text-xs">
				{formatPrice(mapping.outputPrice)}
			</TableCell>
			<TableCell className="tabular-nums text-xs">
				{mapping.contextSize
					? `${(mapping.contextSize / 1000).toFixed(0)}K`
					: "\u2014"}
			</TableCell>
		</TableRow>
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

	const sh = (label: string, sortKey: MappingSortBy) => (
		<TableHead>
			<SortableHeader
				label={label}
				sortKey={sortKey}
				currentSortBy={sortBy}
				currentSortOrder={sortOrder}
				search={search}
				pageWindow={pageWindow}
			/>
		</TableHead>
	);

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
								placeholder="Search by model or provider..."
								defaultValue={search}
								className="h-9 w-64 rounded-md border border-border bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
							/>
						</div>
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
					<TimeWindowSelector current={pageWindow} />
				</Suspense>
			</div>

			<div className="min-w-0 overflow-x-auto rounded-lg border border-border/60 bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							{sh("Provider", "providerId")}
							{sh("Model", "modelId")}
							<TableHead>Status</TableHead>
							{sh("Requests", "logsCount")}
							{sh("Errors", "errorsCount")}
							{sh("Client", "clientErrorsCount")}
							{sh("Gateway", "gatewayErrorsCount")}
							{sh("Upstream", "upstreamErrorsCount")}
							<TableHead>Error Rate</TableHead>
							{sh("Avg TTFT", "avgTimeToFirstToken")}
							<TableHead>Input Price</TableHead>
							<TableHead>Output Price</TableHead>
							<TableHead>Context</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.mappings.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={13}
									className="h-24 text-center text-muted-foreground"
								>
									No mappings found
								</TableCell>
							</TableRow>
						) : (
							data.mappings.map((m) => <MappingRow key={m.id} mapping={m} />)
						)}
					</TableBody>
				</Table>
			</div>
		</div>
	);
}
