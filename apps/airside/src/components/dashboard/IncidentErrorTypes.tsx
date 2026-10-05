"use client";

import { keepPreviousData } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import {
	ClassificationBadge,
	IncidentsTableSkeleton,
	type IncidentsWindow,
	QueryError,
} from "@/components/dashboard/IncidentsTable";
import { Badge } from "@/components/ui/badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useApi } from "@/lib/fetch-client";
import { formatCompact } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { paths } from "@/lib/api/v1";

type ErrorType =
	paths["/airside/incidents/error-types"]["get"]["responses"]["200"]["content"]["application/json"]["errors"][number];

const COLLAPSED_MODELS = 5;

function ErrorTypeItem({
	error,
	showCarrier,
}: {
	error: ErrorType;
	showCarrier: boolean;
}) {
	const [showAll, setShowAll] = useState(false);
	const models = showAll
		? error.models
		: error.models.slice(0, COLLAPSED_MODELS);
	const nonStreamedCount = error.count - error.streamedCount;
	return (
		<li className="border-border/60 bg-background/60 rounded-md border p-3">
			<div className="flex items-center justify-between gap-3">
				<div className="flex flex-wrap items-center gap-2">
					{error.statusCode !== null ? (
						<Badge variant="outline">{error.statusCode}</Badge>
					) : null}
					{error.statusText ? (
						<span className="text-sm font-medium">{error.statusText}</span>
					) : null}
					<ClassificationBadge classification={error.classification} />
				</div>
				<span className="shrink-0 font-mono text-sm font-semibold">
					{formatCompact(error.count)}×
				</span>
			</div>
			<div className="mt-2 flex flex-wrap items-center gap-2">
				{error.streamedCount > 0 ? (
					<Badge variant="secondary">
						Streaming {formatCompact(error.streamedCount)}×
					</Badge>
				) : null}
				{nonStreamedCount > 0 ? (
					<Badge variant="secondary">
						Non-streaming {formatCompact(nonStreamedCount)}×
					</Badge>
				) : null}
				<span className="text-muted-foreground text-xs">
					{error.models.length} model{error.models.length === 1 ? "" : "s"}
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
			<Table className="mt-2">
				<TableHeader>
					<TableRow>
						<TableHead>Model</TableHead>
						{showCarrier ? <TableHead>Carrier</TableHead> : null}
						<TableHead className="text-right">Errors</TableHead>
						<TableHead className="text-right">Streaming</TableHead>
						<TableHead className="text-right">Non-streaming</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{models.map((model) => (
						<TableRow key={model.usedModel}>
							<TableCell className="font-mono">
								<Link
									href={`/dashboard/incidents?mapping=${encodeURIComponent(model.usedModel)}`}
									className="hover:underline"
									title="Open this mapping's incidents"
								>
									{model.modelId}
									{model.region ? (
										<span className="text-muted-foreground">
											:{model.region}
										</span>
									) : null}
								</Link>
							</TableCell>
							{showCarrier ? (
								<TableCell className="text-muted-foreground font-mono">
									{model.providerId}
								</TableCell>
							) : null}
							<TableCell className="text-right font-mono">
								{formatCompact(model.count)}
							</TableCell>
							<TableCell className="text-muted-foreground text-right font-mono">
								{formatCompact(model.streamedCount)}
							</TableCell>
							<TableCell className="text-muted-foreground text-right font-mono">
								{formatCompact(model.count - model.streamedCount)}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
			{error.models.length > COLLAPSED_MODELS ? (
				<button
					type="button"
					className="text-primary mt-2 text-xs hover:underline"
					onClick={() => setShowAll(!showAll)}
				>
					{showAll
						? "Show fewer models"
						: `Show all ${error.models.length} models`}
				</button>
			) : null}
		</li>
	);
}

/** Errors grouped by type across mappings, each with its per-model counts. */
export function IncidentErrorTypes({
	providerCompanyId,
	providerId,
	mapping,
	window,
	includeRetried,
	showCarrier,
}: {
	providerCompanyId: string;
	providerId: string | undefined;
	mapping: string | null;
	window: IncidentsWindow;
	includeRetried: boolean;
	showCarrier: boolean;
}) {
	const api = useApi();
	const { data, isError, isFetching, isPlaceholderData, refetch } =
		api.useQuery(
			"get",
			"/airside/incidents/error-types",
			{
				params: {
					query: {
						providerCompanyId,
						window,
						includeRetried: includeRetried ? "true" : "false",
						...(providerId ? { providerId } : {}),
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

	if (!data) {
		return isError ? (
			<QueryError
				message="Couldn't load errors."
				onRetry={() => void refetch()}
				retrying={isFetching}
			/>
		) : (
			<IncidentsTableSkeleton />
		);
	}

	if (data.errors.length === 0) {
		return (
			<p className="text-muted-foreground py-8 text-center text-sm">
				Clear skies — no errors in this window.
			</p>
		);
	}

	return (
		<div
			className={cn(
				"space-y-3 transition-opacity",
				isPlaceholderData && "pointer-events-none opacity-50",
			)}
			aria-busy={isPlaceholderData}
			data-testid="incident-error-types"
		>
			{isError ? (
				<QueryError
					message="Couldn't refresh errors — showing the last loaded data."
					onRetry={() => void refetch()}
					retrying={isFetching}
				/>
			) : null}
			<p className="text-muted-foreground font-mono text-[0.65rem] tracking-[0.2em] uppercase">
				Top {data.errors.length} error type
				{data.errors.length === 1 ? "" : "s"} ·{" "}
				{formatCompact(data.sampledErrors)} error
				{data.sampledErrors === 1 ? "" : "s"} sampled
			</p>
			{data.cappedMappings > 0 ? (
				<p className="text-muted-foreground text-xs">
					{data.cappedMappings} model{data.cappedMappings === 1 ? "" : "s"} hit
					the {formatCompact(data.sampleLimit)}-error sample cap; counts cover
					each model&apos;s latest {formatCompact(data.sampleLimit)} errors.
				</p>
			) : null}
			<ul className="space-y-3">
				{data.errors.map((error) => (
					<ErrorTypeItem
						key={errorTypeKey(error)}
						error={error}
						showCarrier={showCarrier}
					/>
				))}
			</ul>
		</div>
	);
}
// Stable per-shape key so a refetch that reorders shapes keeps each item's
// expanded state with its own error.
function errorTypeKey(error: ErrorType): string {
	return JSON.stringify([
		error.statusCode,
		error.statusText,
		error.classification,
		error.cause,
		error.responseText,
	]);
}
