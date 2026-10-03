"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { BarChart3, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ErrorShapeTimeline } from "@/components/error-shape-timeline";
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
import {
	ClassificationBadge,
	STREAM_MODES,
} from "@/components/unstable-mappings-table";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import { formatNumber } from "@llmgateway/shared/number-format";

import type { ErrorTimeline } from "@/components/error-shape-timeline";
import type { paths } from "@/lib/api/v1";

type ErrorTypesQuery = paths["/admin/airside/incidents/error-types"]["get"];
type ErrorType =
	ErrorTypesQuery["responses"]["200"]["content"]["application/json"]["errors"][number];

const COLLAPSED_MODELS = 5;

/**
 * Identifies an error type across refetches, so an item's open graph or
 * expanded model list stays with it when counts reorder the list.
 */
export function errorTypeKey(error: ErrorType) {
	return JSON.stringify([
		error.classification,
		error.statusCode,
		error.statusText,
		error.cause,
		error.responseText,
	]);
}

export function ErrorTypeItem({
	error,
	timeline,
}: {
	error: ErrorType;
	/** Bucket grid of `error.buckets`; enables the occurrences graph. */
	timeline?: ErrorTimeline;
}) {
	const [showAll, setShowAll] = useState(false);
	const [showGraph, setShowGraph] = useState(false);
	const models = showAll
		? error.models
		: error.models.slice(0, COLLAPSED_MODELS);
	return (
		<li className="rounded-md border border-border/60 bg-background/60 p-3">
			<div className="flex items-center justify-between gap-3">
				<div className="flex flex-wrap items-center gap-2">
					{error.statusCode !== null && (
						<Badge variant="outline" className="font-mono">
							{error.statusCode}
						</Badge>
					)}
					{error.statusText && (
						<span className="text-sm font-medium">{error.statusText}</span>
					)}
					<ClassificationBadge classification={error.classification} />
				</div>
				<div className="flex shrink-0 items-center gap-2">
					{timeline && error.buckets && (
						<Button
							size="sm"
							variant={showGraph ? "default" : "outline"}
							className="h-7 px-2 text-xs"
							aria-pressed={showGraph}
							title="Show occurrences over the selected window"
							onClick={() => setShowGraph(!showGraph)}
						>
							<BarChart3 className="h-3.5 w-3.5" />
							Graph
						</Button>
					)}
					<span className="text-sm font-semibold tabular-nums">
						{formatNumber(error.count)}×
					</span>
				</div>
			</div>
			{showGraph && timeline && error.buckets && (
				<div className="mt-2">
					<ErrorShapeTimeline timeline={timeline} buckets={error.buckets} />
				</div>
			)}
			<div className="mt-2 flex flex-wrap items-center gap-2">
				{STREAM_MODES.map((mode) => ({
					...mode,
					count: mode.streamed
						? error.streamedCount
						: error.count - error.streamedCount,
				}))
					.filter((mode) => mode.count > 0)
					.map((mode) => (
						<Badge
							key={mode.label}
							className={cn("font-medium tabular-nums", mode.badgeClass)}
						>
							{mode.label} {formatNumber(mode.count)}×
						</Badge>
					))}
				<span className="text-xs text-muted-foreground">
					{error.models.length} model{error.models.length === 1 ? "" : "s"}
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
			<Table className="mt-2">
				<TableHeader>
					<TableRow>
						<TableHead>Model</TableHead>
						<TableHead className="text-right">Errors</TableHead>
						<TableHead className="text-right">Streaming</TableHead>
						<TableHead className="text-right">Non-streaming</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{models.map((model) => (
						<TableRow key={`${model.providerId}:${model.usedModel}`}>
							<TableCell className="font-mono text-xs">
								<Link
									href={`/providers/${encodeURIComponent(model.providerId)}/incidents?mapping=${encodeURIComponent(model.usedModel)}`}
									className="hover:underline"
									title="Open this mapping's incidents"
								>
									{model.modelId}
									{model.region && (
										<span className="text-muted-foreground">
											:{model.region}
										</span>
									)}
								</Link>
							</TableCell>
							<TableCell className="text-right tabular-nums">
								{formatNumber(model.count)}
							</TableCell>
							<TableCell className="text-right tabular-nums text-muted-foreground">
								{formatNumber(model.streamedCount)}
							</TableCell>
							<TableCell className="text-right tabular-nums text-muted-foreground">
								{formatNumber(model.count - model.streamedCount)}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
			{error.models.length > COLLAPSED_MODELS && (
				<Button
					size="sm"
					variant="ghost"
					className="mt-1 h-7 px-2 text-xs"
					onClick={() => setShowAll(!showAll)}
				>
					{showAll
						? "Show fewer models"
						: `Show all ${error.models.length} models`}
				</Button>
			)}
		</li>
	);
}

/** Errors grouped by type across mappings, each with its per-model counts. */
export function ProviderIncidentErrorTypes({
	providerId,
	mapping,
	window,
	includeRetried,
}: {
	providerId: string;
	mapping: string | null;
	window: NonNullable<ErrorTypesQuery["parameters"]["query"]["window"]>;
	includeRetried: boolean;
}) {
	const $api = useApi();
	const { data, isError, isFetching, isPlaceholderData, refetch } =
		$api.useQuery(
			"get",
			"/admin/airside/incidents/error-types",
			{
				params: {
					query: {
						providerId,
						window,
						includeRetried: includeRetried ? "true" : "false",
						...(mapping !== null ? { mapping } : {}),
					},
				},
			},
			{
				refetchInterval: 15_000,
				refetchIntervalInBackground: false,
				placeholderData: keepPreviousData,
			},
		);

	const queryError = isError && (
		<div
			role="alert"
			className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
		>
			<span>
				{data
					? "Couldn't refresh errors — showing the last loaded data."
					: "Couldn't load errors."}
			</span>
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

	if (!data) {
		return (
			<div className="space-y-3 p-4" aria-busy={!isError}>
				{queryError ||
					[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-9 w-full" />)}
			</div>
		);
	}

	if (data.errors.length === 0) {
		return (
			<div className="p-8 text-center text-sm text-muted-foreground">
				No errors in this window.
			</div>
		);
	}

	return (
		<div
			className={cn(
				"space-y-3 p-4 transition-opacity",
				isPlaceholderData && "pointer-events-none opacity-50",
			)}
			aria-busy={isPlaceholderData}
		>
			{queryError}
			<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
				Top {data.errors.length} error type
				{data.errors.length === 1 ? "" : "s"} ·{" "}
				{formatNumber(data.sampledErrors)} sampled
			</p>
			{data.cappedMappings > 0 && (
				<p className="text-xs text-muted-foreground">
					{data.cappedMappings} model{data.cappedMappings === 1 ? "" : "s"} hit
					the {formatNumber(data.sampleLimit)}-error sample cap; counts cover
					each model&apos;s latest {formatNumber(data.sampleLimit)} errors.
				</p>
			)}
			<ul className="space-y-3">
				{data.errors.map((error) => (
					<ErrorTypeItem key={errorTypeKey(error)} error={error} />
				))}
			</ul>
		</div>
	);
}
