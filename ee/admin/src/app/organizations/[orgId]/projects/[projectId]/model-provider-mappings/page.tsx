import { ArrowLeft, Search } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ProjectMappingsTable } from "@/components/project-mappings-table";
import { TimeWindowSelector } from "@/components/time-window-selector";
import { Button } from "@/components/ui/button";
import { parsePageWindow, windowToFromTo } from "@/lib/page-window";
import { requireSession } from "@/lib/require-session";
import { createServerApiClient } from "@/lib/server-api";

type SortBy = "logsCount" | "errorsCount" | "cost" | "modelId" | "providerId";
type SortOrder = "asc" | "desc";

const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 4,
});

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

export default async function ProjectModelProviderMappingsPage({
	params,
	searchParams,
}: {
	params: Promise<{ orgId: string; projectId: string }>;
	searchParams?: Promise<{
		search?: string;
		sortBy?: string;
		sortOrder?: string;
		window?: string;
	}>;
}) {
	await requireSession();

	const { orgId, projectId } = await params;
	const sp = await searchParams;
	const search = sp?.search ?? "";
	const sortBy = (sp?.sortBy as SortBy) ?? "logsCount";
	const sortOrder = (sp?.sortOrder as SortOrder) ?? "desc";
	const pageWindow = parsePageWindow(sp?.window);
	const { from, to } = windowToFromTo(pageWindow);
	const basePath = `/organizations/${orgId}/projects/${projectId}/model-provider-mappings`;

	const $api = await createServerApiClient();

	const [projectsRes, statsRes] = await Promise.all([
		$api.GET("/admin/organizations/{orgId}/projects", {
			params: { path: { orgId } },
		}),
		$api.GET(
			"/admin/organizations/{orgId}/projects/{projectId}/model-provider-stats",
			{
				params: {
					path: { orgId, projectId },
					query: { search, sortBy, sortOrder, limit: 500, offset: 0, from, to },
				},
			},
		),
	]);

	const projectsData = projectsRes.data;
	if (!projectsData) {
		notFound();
	}

	const project = projectsData.projects.find((p) => p.id === projectId);
	if (!project) {
		notFound();
	}

	const data = statsRes.data;

	if (!data) {
		notFound();
	}

	async function handleSearch(formData: FormData) {
		"use server";
		const searchValue = formData.get("search") as string;
		const windowValue = formData.get("window") as string;
		const searchParam = searchValue
			? `&search=${encodeURIComponent(searchValue)}`
			: "";
		const windowParam = windowValue ? `&window=${windowValue}` : "";
		redirect(
			`${basePath}?sortBy=${sortBy}&sortOrder=${sortOrder}${searchParam}${windowParam}`,
		);
	}

	return (
		<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 overflow-hidden px-4 py-8 md:px-8">
			<header className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
				<div>
					<Button variant="ghost" size="sm" asChild className="mb-2">
						<Link href={`/organizations/${orgId}/projects/${projectId}`}>
							<ArrowLeft className="mr-1 h-4 w-4" />
							Back to Project
						</Link>
					</Button>
					<h1 className="text-3xl font-semibold tracking-tight">
						Model-Provider Mappings
					</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						{data.total} model-provider combinations for{" "}
						<strong>{project.name}</strong>
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

			<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div className="flex flex-wrap items-center gap-6 text-sm">
					<div>
						<span className="text-muted-foreground">Total Requests</span>
						<p className="text-xl font-semibold tabular-nums">
							{formatCompactNumber(data.totalRequests)}
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
				<div className="flex flex-col items-end gap-1">
					<Suspense>
						<TimeWindowSelector current={pageWindow} />
					</Suspense>
					<p className="text-[11px] text-muted-foreground">
						Per-project data is bucketed hourly
					</p>
				</div>
			</div>

			<div className="min-w-0 overflow-x-auto rounded-lg border border-border/60 bg-card">
				<ProjectMappingsTable
					mappings={data.mappings}
					projectId={projectId}
					sortBy={sortBy}
					sortOrder={sortOrder}
					search={search}
					pageWindow={pageWindow}
					basePath={basePath}
				/>
			</div>
		</div>
	);
}
