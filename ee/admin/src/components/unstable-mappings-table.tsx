"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Fragment, useState } from "react";

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
import { cn } from "@/lib/utils";

import { getProviderIcon } from "@llmgateway/shared";

import type { UnstableWindow } from "@/lib/unstable-mappings-params";

interface UnstableMapping {
	modelId: string;
	region: string | null;
	usedModel: string;
	providerId: string;
	providerName: string;
	logsCount: number;
	errorsCount: number;
	errorRate: number;
}

const percentFormatter = new Intl.NumberFormat("en-US", {
	style: "percent",
	maximumFractionDigits: 1,
});

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
	usedModel,
	provider,
	includeRetried,
	window,
	logLimit,
}: {
	usedModel: string;
	provider: string;
	includeRetried: boolean;
	window: UnstableWindow;
	logLimit: number;
}) {
	const $api = useApi();
	const { data, isLoading, isError } = $api.useQuery(
		"get",
		"/admin/unstable-mappings/errors",
		{
			params: {
				query: {
					model: usedModel,
					provider,
					includeRetried: includeRetried ? "true" : "false",
					window,
					logLimit,
				},
			},
		},
	);

	if (isLoading) {
		return (
			<div className="space-y-2 p-4">
				{[0, 1, 2].map((i) => (
					<div key={i} className="h-8 animate-pulse rounded bg-muted/40" />
				))}
			</div>
		);
	}

	if (isError) {
		return (
			<p className="p-4 text-sm text-muted-foreground">
				Failed to load error details.
			</p>
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

	return (
		<div className="space-y-3 p-4">
			<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
				Top {errors.length} error{errors.length === 1 ? "" : "s"} ·{" "}
				{data?.sampledErrors.toLocaleString()} sampled
			</p>
			<ul className="space-y-2">
				{errors.map((error, i) => (
					<li
						key={i}
						className="rounded-md border border-border/60 bg-background/60 p-3"
					>
						<div className="flex items-center justify-between gap-3">
							<div className="flex items-center gap-2">
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
							</div>
							<span className="shrink-0 text-sm font-semibold tabular-nums">
								{error.count.toLocaleString()}×
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
	);
}

export function UnstableMappingsTable({
	mappings,
	includeRetried,
	window,
	logLimit,
}: {
	mappings: UnstableMapping[];
	includeRetried: boolean;
	window: UnstableWindow;
	logLimit: number;
}) {
	const [expanded, setExpanded] = useState<string | null>(null);

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
					<TableHead className="text-right">Error Rate</TableHead>
					<TableHead className="text-right">Errors</TableHead>
					<TableHead className="text-right">Logs</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{mappings.map((mapping) => {
					const key = `${mapping.providerId}/${mapping.usedModel}`;
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
								</TableCell>
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
									{mapping.errorsCount.toLocaleString()}
								</TableCell>
								<TableCell className="text-right tabular-nums text-muted-foreground">
									{mapping.logsCount.toLocaleString()}
								</TableCell>
							</TableRow>
							{isOpen && (
								<TableRow className="hover:bg-transparent">
									<TableCell colSpan={6} className="bg-muted/20 p-0">
										<ErrorDetails
											usedModel={mapping.usedModel}
											provider={mapping.providerId}
											includeRetried={includeRetried}
											window={window}
											logLimit={logLimit}
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
