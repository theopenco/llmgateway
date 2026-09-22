"use client";

import {
	AlertTriangle,
	ChevronDown,
	ChevronRight,
	Loader2,
} from "lucide-react";
import { Fragment, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useApi } from "@/lib/fetch-client";
import { formatCompact, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { paths } from "@/lib/api/v1";

export type IncidentsWindow = NonNullable<
	paths["/airside/incidents"]["get"]["parameters"]["query"]["window"]
>;

type IncidentMapping =
	paths["/airside/incidents"]["get"]["responses"]["200"]["content"]["application/json"]["mappings"][number];

// The gateway's classification of each failure. The HTTP status alone is
// misleading: some 4xx responses are gateway or upstream errors.
const classificationBadges: Record<string, { label: string; class: string }> = {
	gateway_error: {
		label: "Gateway error",
		class: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
	},
	upstream_error: {
		label: "Upstream error",
		class: "bg-red-500/15 text-red-600 dark:text-red-400",
	},
	content_filter: {
		label: "Content filter",
		class: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
	},
	canceled: {
		label: "Canceled",
		class: "bg-muted text-muted-foreground",
	},
};

function ClassificationBadge({
	classification,
}: {
	classification: string | null;
}) {
	if (!classification) {
		return null;
	}
	const badge = classificationBadges[classification] ?? {
		label: classification,
		class: "bg-muted text-muted-foreground",
	};
	return (
		<Badge className={cn("border-transparent", badge.class)}>
			{badge.label}
		</Badge>
	);
}

export function QueryError({
	message,
	onRetry,
	retrying,
}: {
	message: string;
	onRetry: () => void;
	retrying: boolean;
}) {
	return (
		<div
			role="alert"
			className="border-destructive/40 bg-destructive/5 flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm"
		>
			<span className="flex items-center gap-2">
				<AlertTriangle className="text-destructive size-4 shrink-0" />
				{message}
			</span>
			<Button size="sm" variant="outline" onClick={onRetry} disabled={retrying}>
				{retrying ? <Loader2 className="size-3.5 animate-spin" /> : null}
				Retry
			</Button>
		</div>
	);
}

export function IncidentsTableSkeleton() {
	return (
		<div className="space-y-3" aria-busy>
			<p className="text-muted-foreground flex items-center gap-2 text-xs">
				<Loader2 className="size-3.5 animate-spin" />
				Loading incidents — longer windows can take a few seconds…
			</p>
			{[0, 1, 2, 3].map((i) => (
				<Skeleton key={i} className="h-9 w-full" />
			))}
		</div>
	);
}

function errorRateClass(rate: number): string {
	if (rate >= 0.5) {
		return "bg-red-500/15 text-red-600 dark:text-red-400";
	}
	if (rate >= 0.2) {
		return "bg-orange-500/15 text-orange-600 dark:text-orange-400";
	}
	return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400";
}

function ErrorDetails({
	providerCompanyId,
	mapping,
	window,
	includeRetried,
}: {
	providerCompanyId: string;
	mapping: IncidentMapping;
	window: IncidentsWindow;
	includeRetried: boolean;
}) {
	const api = useApi();
	const { data, isLoading, isError, isFetching, refetch } = api.useQuery(
		"get",
		"/airside/incidents/errors",
		{
			params: {
				query: {
					providerCompanyId,
					providerId: mapping.providerId,
					mapping: mapping.usedModel,
					window,
					includeRetried: includeRetried ? "true" : "false",
				},
			},
		},
	);

	if (isLoading) {
		return (
			<div className="space-y-2 p-4" aria-busy>
				<p className="text-muted-foreground flex items-center gap-2 text-xs">
					<Loader2 className="size-3.5 animate-spin" />
					Pulling the flight recorder — scanning error logs…
				</p>
				{[0, 1, 2].map((i) => (
					<Skeleton key={i} className="h-12 w-full" />
				))}
			</div>
		);
	}

	if (isError) {
		return (
			<div className="p-4">
				<QueryError
					message="Couldn't load error details."
					onRetry={() => void refetch()}
					retrying={isFetching}
				/>
			</div>
		);
	}

	const errors = data?.errors ?? [];
	if (errors.length === 0) {
		return (
			<p className="text-muted-foreground p-4 text-sm">
				No error details recorded in this window.
			</p>
		);
	}

	// Streaming and non-streaming requests often fail differently.
	const groups = [
		{ label: "Streaming", errors: errors.filter((error) => error.streamed) },
		{
			label: "Non-streaming",
			errors: errors.filter((error) => !error.streamed),
		},
	].filter((group) => group.errors.length > 0);

	return (
		<div className="space-y-4 p-4">
			<p className="text-muted-foreground font-mono text-[0.65rem] tracking-[0.2em] uppercase">
				Top {errors.length} error shape{errors.length === 1 ? "" : "s"} ·{" "}
				{formatCompact(data?.sampledErrors ?? 0)} errors sampled
			</p>
			{groups.map((group) => (
				<div key={group.label} className="space-y-2">
					<Badge variant="secondary">{group.label}</Badge>
					<ul className="space-y-2">
						{group.errors.map((error, i) => (
							<li
								key={i}
								className="border-border/60 bg-background/60 rounded-md border p-3"
							>
								<div className="flex items-center justify-between gap-3">
									<div className="flex flex-wrap items-center gap-2">
										{error.statusCode !== null ? (
											<Badge variant="outline">{error.statusCode}</Badge>
										) : null}
										{error.statusText ? (
											<span className="text-sm font-medium">
												{error.statusText}
											</span>
										) : null}
										<ClassificationBadge
											classification={error.classification}
										/>
									</div>
									<span className="shrink-0 font-mono text-sm font-semibold">
										{formatCompact(error.count)}×
									</span>
								</div>
								{error.responseText ? (
									<pre className="bg-muted/40 text-muted-foreground mt-2 max-h-40 overflow-auto rounded p-2 text-xs break-words whitespace-pre-wrap">
										{error.responseText}
									</pre>
								) : null}
								{error.cause ? (
									<p className="text-muted-foreground mt-1 text-xs">
										Cause: {error.cause}
									</p>
								) : null}
							</li>
						))}
					</ul>
				</div>
			))}
		</div>
	);
}

export function IncidentsTable({
	providerCompanyId,
	mappings,
	window,
	includeRetried,
}: {
	providerCompanyId: string;
	mappings: IncidentMapping[];
	window: IncidentsWindow;
	includeRetried: boolean;
}) {
	const [expanded, setExpanded] = useState<string | null>(
		mappings.length === 1 ? mappings[0].usedModel : null,
	);

	if (mappings.length === 0) {
		return (
			<p className="text-muted-foreground py-8 text-center text-sm">
				Clear skies — no errors in this window.
			</p>
		);
	}

	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead className="w-8" />
					<TableHead>Model</TableHead>
					<TableHead>Carrier</TableHead>
					<TableHead className="text-right">Error rate</TableHead>
					<TableHead className="text-right">Errors</TableHead>
					<TableHead className="text-right">Upstream / Gateway</TableHead>
					<TableHead className="text-right">Requests</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{mappings.map((mapping) => {
					const isOpen = expanded === mapping.usedModel;
					return (
						<Fragment key={mapping.usedModel}>
							<TableRow>
								<TableCell>
									<button
										type="button"
										className="text-muted-foreground hover:bg-muted inline-flex size-6 items-center justify-center rounded-sm"
										aria-label={
											isOpen ? "Collapse error details" : "Expand error details"
										}
										aria-expanded={isOpen}
										onClick={() =>
											setExpanded(isOpen ? null : mapping.usedModel)
										}
									>
										{isOpen ? (
											<ChevronDown className="size-4" />
										) : (
											<ChevronRight className="size-4" />
										)}
									</button>
								</TableCell>
								<TableCell className="font-mono">
									{mapping.modelId}
									{mapping.region ? (
										<span className="text-muted-foreground">
											:{mapping.region}
										</span>
									) : null}
								</TableCell>
								<TableCell className="text-muted-foreground font-mono">
									{mapping.providerId}
								</TableCell>
								<TableCell className="text-right">
									<Badge
										className={cn(
											"ml-auto border-transparent",
											mapping.errorCount === 0
												? "bg-muted text-muted-foreground"
												: errorRateClass(mapping.errorRate),
										)}
									>
										{formatPercent(mapping.errorRate)}
									</Badge>
								</TableCell>
								<TableCell className="text-right font-mono">
									{formatCompact(mapping.errorCount)}
								</TableCell>
								<TableCell className="text-muted-foreground text-right font-mono">
									{formatCompact(mapping.upstreamErrorCount)} /{" "}
									{formatCompact(mapping.gatewayErrorCount)}
								</TableCell>
								<TableCell className="text-muted-foreground text-right font-mono">
									{formatCompact(mapping.requestCount)}
								</TableCell>
							</TableRow>
							{isOpen ? (
								<TableRow className="hover:bg-transparent">
									<TableCell colSpan={7} className="bg-muted/20 p-0">
										<ErrorDetails
											providerCompanyId={providerCompanyId}
											mapping={mapping}
											window={window}
											includeRetried={includeRetried}
										/>
									</TableCell>
								</TableRow>
							) : null}
						</Fragment>
					);
				})}
			</TableBody>
		</Table>
	);
}
