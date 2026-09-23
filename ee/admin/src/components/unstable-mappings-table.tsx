"use client";

import {
	Boxes,
	ChevronDown,
	ChevronRight,
	Filter,
	Loader2,
} from "lucide-react";
import Link from "next/link";
import { Fragment, useState } from "react";

import { useFilterNavigation } from "@/components/filter-navigation";
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
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import { ERROR_CLASSIFICATIONS, getProviderIcon } from "@llmgateway/shared";
import { formatNumber } from "@llmgateway/shared/number-format";

import type { UnstableWindow } from "@/lib/unstable-mappings-params";

interface UnstableMapping {
	modelId: string;
	region: string | null;
	usedModel: string;
	providerId: string;
	providerName: string;
	providerKeyId: string | null;
	providerKeyLabel: string | null;
	providerKeyMaskedToken: string | null;
	providerKeyManaged: boolean | null;
	logsCount: number;
	errorsCount: number;
	errorRate: number;
}

/**
 * Sentinel the errors endpoint accepts for "logs with no provider key at all"
 * — env-var credentials, or failures that never resolved one. Keeps the
 * drilldown of an unattributed row scoped to that row instead of silently
 * mixing every key's errors back together.
 */
const UNATTRIBUTED_KEY = "__unattributed__";

export const percentFormatter = new Intl.NumberFormat("en-US", {
	style: "percent",
	maximumFractionDigits: 1,
});

function ClassificationBadge({
	classification,
}: {
	classification: string | null;
}) {
	if (!classification) {
		return null;
	}
	const badge = ERROR_CLASSIFICATIONS[classification];
	return (
		<>
			<Badge
				className={cn(
					"font-medium",
					badge?.badgeClass ?? "bg-muted text-muted-foreground",
				)}
			>
				{badge?.label ?? classification}
			</Badge>
			{badge && (
				<span className="text-xs text-muted-foreground">{badge.hint}</span>
			)}
		</>
	);
}

export function errorRateClass(rate: number): string {
	if (rate >= 0.5) {
		return "bg-red-500/15 text-red-600 dark:text-red-400";
	}
	if (rate >= 0.2) {
		return "bg-orange-500/15 text-orange-600 dark:text-orange-400";
	}
	return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400";
}

export function ErrorDetails({
	usedModel,
	provider,
	providerKeyId,
	includeRetried,
	window,
	logLimit,
	ignoreExpected,
	includeByok,
	incidentsOnly = false,
}: {
	usedModel: string;
	provider: string;
	providerKeyId: string | undefined;
	includeRetried: boolean;
	window: UnstableWindow;
	logLimit: number;
	ignoreExpected: boolean;
	includeByok: boolean;
	/** Only upstream and gateway errors, matching the Incidents counts. */
	incidentsOnly?: boolean;
}) {
	const $api = useApi();
	const { data, isLoading, isError, isFetching, refetch } = $api.useQuery(
		"get",
		"/admin/unstable-mappings/errors",
		{
			params: {
				query: {
					model: usedModel,
					provider,
					providerKeyId,
					includeRetried: includeRetried ? "true" : "false",
					window,
					logLimit,
					ignoreExpected: ignoreExpected ? "true" : "false",
					includeByok: includeByok ? "true" : "false",
					incidentsOnly: incidentsOnly ? "true" : "false",
				},
			},
		},
	);

	if (isLoading) {
		return (
			<div className="space-y-2 p-4" aria-busy>
				<p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
					<Loader2 className="h-3.5 w-3.5 animate-spin" />
					Scanning logs for error details…
				</p>
				{[0, 1, 2].map((i) => (
					<div key={i} className="h-8 animate-pulse rounded bg-muted/40" />
				))}
			</div>
		);
	}

	if (isError) {
		return (
			<div
				role="alert"
				className="m-4 flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
			>
				<span>Failed to load error details.</span>
				<Button
					size="sm"
					variant="outline"
					disabled={isFetching}
					onClick={() => void refetch()}
				>
					{isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
					Retry
				</Button>
			</div>
		);
	}

	const errors = data?.errors ?? [];

	if (errors.length === 0) {
		return (
			<p className="p-4 text-sm text-muted-foreground">
				No error details available in the sampled window.
			</p>
		);
	}

	// Streaming and non-streaming requests often fail differently, so split
	// the drilldown into one section per mode to make debugging easier.
	const groups = [
		{
			label: "Streaming",
			badgeClass: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
			errors: errors.filter((error) => error.streamed),
		},
		{
			label: "Non-streaming",
			badgeClass: "bg-muted text-muted-foreground",
			errors: errors.filter((error) => !error.streamed),
		},
	].filter((group) => group.errors.length > 0);

	return (
		<div className="space-y-4 p-4">
			<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
				Top {errors.length} error{errors.length === 1 ? "" : "s"} ·{" "}
				{data ? formatNumber(data.sampledErrors) : null} sampled
			</p>
			{groups.map((group) => (
				<div key={group.label} className="space-y-2">
					<div className="flex items-center gap-2">
						<Badge className={cn("font-medium", group.badgeClass)}>
							{group.label}
						</Badge>
						<span className="text-xs text-muted-foreground">
							{group.errors.length} error
							{group.errors.length === 1 ? "" : "s"} ·{" "}
							{formatNumber(
								group.errors.reduce((sum, error) => sum + error.count, 0),
							)}
							× total
						</span>
					</div>
					<ul className="space-y-2">
						{group.errors.map((error, i) => (
							<li
								key={i}
								className="rounded-md border border-border/60 bg-background/60 p-3"
							>
								<div className="flex items-center justify-between gap-3">
									<div className="flex flex-wrap items-center gap-2">
										{error.statusCode !== null && (
											<Badge variant="outline" className="font-mono">
												{error.statusCode}
											</Badge>
										)}
										{error.statusText && (
											<span className="text-sm font-medium">
												{error.statusText}
											</span>
										)}
										<ClassificationBadge
											classification={error.classification}
										/>
									</div>
									<span className="shrink-0 text-sm font-semibold tabular-nums">
										{formatNumber(error.count)}×
									</span>
								</div>
								{error.responseText && (
									<pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 text-xs text-muted-foreground">
										{error.responseText}
									</pre>
								)}
								{error.cause && (
									<p className="mt-1 text-xs text-muted-foreground">
										Cause: {error.cause}
									</p>
								)}
							</li>
						))}
					</ul>
				</div>
			))}
		</div>
	);
}

export function UnstableMappingsTable({
	mappings,
	includeRetried,
	window,
	logLimit,
	ignoreExpected,
	splitByKey,
	includeByok,
}: {
	mappings: UnstableMapping[];
	includeRetried: boolean;
	window: UnstableWindow;
	logLimit: number;
	ignoreExpected: boolean;
	splitByKey: boolean;
	includeByok: boolean;
}) {
	const [expanded, setExpanded] = useState<string | null>(null);
	const { isPending, navigate } = useFilterNavigation();
	const columnCount = splitByKey ? 7 : 6;

	if (mappings.length === 0) {
		return (
			<div className="p-8 text-center text-sm text-muted-foreground">
				No unstable mappings in the sampled window. 🎉
			</div>
		);
	}

	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead className="w-8" />
					<TableHead>Provider</TableHead>
					<TableHead>Model</TableHead>
					{splitByKey && <TableHead>Key</TableHead>}
					<TableHead className="text-right">Error Rate</TableHead>
					<TableHead className="text-right">Errors</TableHead>
					<TableHead className="text-right">Logs</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{mappings.map((mapping) => {
					const key = `${mapping.providerId}/${mapping.usedModel}/${mapping.providerKeyId ?? "none"}`;
					const isOpen = expanded === key;
					const ProviderIcon = getProviderIcon(mapping.providerId);
					return (
						<Fragment key={key}>
							<TableRow>
								<TableCell>
									<button
										type="button"
										className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
										aria-label={
											isOpen ? "Collapse error details" : "Expand error details"
										}
										aria-expanded={isOpen}
										onClick={() => setExpanded(isOpen ? null : key)}
									>
										{isOpen ? (
											<ChevronDown className="h-4 w-4" />
										) : (
											<ChevronRight className="h-4 w-4" />
										)}
									</button>
								</TableCell>
								<TableCell>
									<Link
										href={`/providers/${encodeURIComponent(mapping.providerId)}`}
										className="flex items-center gap-2 hover:underline"
									>
										<ProviderIcon className="h-4 w-4 shrink-0 dark:text-white" />
										<span>{mapping.providerName}</span>
									</Link>
								</TableCell>
								<TableCell>
									<div className="flex items-center gap-1">
										<Link
											href={`/model-provider-mappings/${encodeURIComponent(mapping.providerId)}/${encodeURIComponent(mapping.modelId)}${mapping.region ? `?region=${encodeURIComponent(mapping.region)}` : ""}`}
											className="font-mono text-xs hover:underline"
										>
											{mapping.modelId}
											{mapping.region && (
												<span className="text-muted-foreground">
													:{mapping.region}
												</span>
											)}
										</Link>
										<button
											type="button"
											className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted disabled:opacity-50"
											aria-label="Filter to this mapping"
											title="Filter to this mapping"
											disabled={isPending}
											onClick={() =>
												navigate(
													`scope:mapping:${mapping.usedModel}`,
													(params) => {
														params.delete("modelId");
														params.set("mapping", mapping.usedModel);
													},
												)
											}
										>
											<Filter className="h-3.5 w-3.5" />
										</button>
										<button
											type="button"
											className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted disabled:opacity-50"
											aria-label="Filter to every mapping of this model"
											title="Filter to every mapping of this model"
											disabled={isPending}
											onClick={() =>
												navigate(
													`scope:modelId:${mapping.modelId}`,
													(params) => {
														params.delete("mapping");
														params.set("modelId", mapping.modelId);
													},
												)
											}
										>
											<Boxes className="h-3.5 w-3.5" />
										</button>
									</div>
								</TableCell>
								{splitByKey && (
									<TableCell>
										{mapping.providerKeyId ? (
											<div className="flex items-center gap-2">
												<span
													className="max-w-[220px] truncate font-mono text-xs"
													title={
														mapping.providerKeyMaskedToken ??
														mapping.providerKeyLabel ??
														mapping.providerKeyId
													}
												>
													{mapping.providerKeyLabel ?? mapping.providerKeyId}
												</span>
												<Badge
													variant="secondary"
													className="text-[11px] text-muted-foreground"
												>
													{mapping.providerKeyManaged ? "managed" : "byok"}
												</Badge>
											</div>
										) : (
											<span
												className="text-xs text-muted-foreground"
												title="Served by an env-var key, or the request failed before a credential was resolved."
											>
												env / unattributed
											</span>
										)}
									</TableCell>
								)}
								<TableCell className="text-right">
									<Badge
										className={cn(
											"font-semibold tabular-nums",
											errorRateClass(mapping.errorRate),
										)}
									>
										{percentFormatter.format(mapping.errorRate)}
									</Badge>
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{formatNumber(mapping.errorsCount)}
								</TableCell>
								<TableCell className="text-right tabular-nums text-muted-foreground">
									{formatNumber(mapping.logsCount)}
								</TableCell>
							</TableRow>
							{isOpen && (
								<TableRow className="hover:bg-transparent">
									<TableCell colSpan={columnCount} className="bg-muted/20 p-0">
										<ErrorDetails
											usedModel={mapping.usedModel}
											provider={mapping.providerId}
											providerKeyId={
												splitByKey
													? (mapping.providerKeyId ?? UNATTRIBUTED_KEY)
													: undefined
											}
											includeRetried={includeRetried}
											window={window}
											logLimit={logLimit}
											ignoreExpected={ignoreExpected}
											includeByok={includeByok}
										/>
									</TableCell>
								</TableRow>
							)}
						</Fragment>
					);
				})}
			</TableBody>
		</Table>
	);
}
