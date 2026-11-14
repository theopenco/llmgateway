"use client";

import {
	AlertCircle,
	AlertTriangle,
	ArrowDown,
	ArrowUp,
	ArrowUpRight,
	Check,
	ChevronDown,
	Copy,
	Server,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import { ModelCtaButton } from "@/components/models/model-cta-button";
import { Button } from "@/lib/components/button";
import { TooltipProvider } from "@/lib/components/tooltip";
import {
	MIN_SIGNIFICANT_REQUESTS,
	useModelBenchmarks,
} from "@/lib/use-model-benchmarks";
import { cn } from "@/lib/utils";

import {
	CarrierMark,
	effectiveTokenPrice,
	effectiveUnitPrice,
	formatContextSize,
	formatPerUnitPrice,
	getDefaultProviderMapping,
	getInputAudioHourPrice,
	getInputCharacterPricePer1K,
	getMinPerImagePrice,
	getMinPerSecondPrice,
	getProviderIcon,
	isMappingDeactivated,
} from "@llmgateway/shared/components";
import { formatNumber } from "@llmgateway/shared/number-format";

import { formatDetailPrice } from "./detail-price";
import { ProviderSection } from "./model-card";

import type {
	ApiModel,
	ApiModelProviderMapping,
	ApiProvider,
} from "@/lib/fetch-models";

interface ModelWithProviders extends ApiModel {
	providerDetails: Array<{
		provider: ApiModelProviderMapping;
		providerInfo: ApiProvider;
	}>;
}

interface ProviderGroup {
	providerInfo: ApiProvider;
	providerId: string;
	mappings: ApiModelProviderMapping[];
	mapping: ApiModelProviderMapping;
}

interface ProviderPerformance {
	tokensPerSecond: number | null;
	avgTimeToFirstToken: number | null;
	uptime: number | null;
}

type ColumnKey =
	| "context"
	| "maxOutput"
	| "input"
	| "output"
	| "cache"
	| "imageOutput"
	| "image"
	| "video"
	| "speech"
	| "transcription"
	| "request"
	| "ocr"
	| "throughput"
	| "latency"
	| "uptime";

interface Column {
	key: ColumnKey;
	label: string;
	unit?: string;
	better: "low" | "high";
	performance?: boolean;
	value: (
		group: ProviderGroup,
		performance: ProviderPerformance | undefined,
	) => number | null;
	format: (value: number) => string;
}

const formatUsd = (value: number) => {
	const rounded = parseFloat(value.toFixed(4));
	return `$${Number.isInteger(rounded * 100) ? rounded.toFixed(2) : rounded}`;
};

// Prices mirror the expanded card's default mapping at peak rates, so the
// table never ranks a provider on a cheaper secondary region or off-peak rate.
const COLUMNS: Column[] = [
	{
		key: "context",
		label: "Context",
		better: "high",
		value: ({ mapping }) => mapping.contextSize || null,
		format: (value) => formatContextSize(value),
	},
	{
		key: "maxOutput",
		label: "Max output",
		better: "high",
		value: ({ mapping }) => mapping.maxOutput || null,
		format: (value) => formatContextSize(value),
	},
	{
		key: "input",
		label: "Input",
		unit: "$/M",
		better: "low",
		value: ({ mapping }) =>
			effectiveTokenPrice(
				mapping.peakPricing?.peak.inputPrice ?? mapping.inputPrice,
				mapping.discount,
			),
		format: formatUsd,
	},
	{
		key: "output",
		label: "Output",
		unit: "$/M",
		better: "low",
		value: ({ mapping }) =>
			effectiveTokenPrice(
				mapping.peakPricing?.peak.outputPrice ?? mapping.outputPrice,
				mapping.discount,
			),
		format: formatUsd,
	},
	{
		key: "cache",
		label: "Cache read",
		unit: "$/M",
		better: "low",
		value: ({ mapping }) =>
			effectiveTokenPrice(
				mapping.peakPricing?.peak.cachedInputPrice ?? mapping.cachedInputPrice,
				mapping.discount,
			),
		format: formatUsd,
	},
	{
		key: "imageOutput",
		label: "Image output",
		unit: "$/M",
		better: "low",
		value: ({ mapping }) =>
			effectiveTokenPrice(mapping.imageOutputPrice, mapping.discount),
		format: formatUsd,
	},
	{
		key: "image",
		label: "Image",
		unit: "from $/image",
		better: "low",
		value: ({ mapping }) => getMinPerImagePrice(mapping),
		format: formatPerUnitPrice,
	},
	{
		key: "video",
		label: "Video",
		unit: "from $/sec",
		better: "low",
		value: ({ mapping }) => getMinPerSecondPrice(mapping),
		format: formatPerUnitPrice,
	},
	{
		key: "speech",
		label: "Speech",
		unit: "$/1K chars",
		better: "low",
		value: ({ mapping }) => getInputCharacterPricePer1K(mapping) || null,
		format: formatPerUnitPrice,
	},
	{
		key: "transcription",
		label: "Audio",
		unit: "$/hour",
		better: "low",
		value: ({ mapping }) => getInputAudioHourPrice(mapping) || null,
		format: formatPerUnitPrice,
	},
	{
		key: "request",
		label: "Requests",
		unit: "$/1K",
		better: "low",
		value: ({ mapping }) => {
			const price = effectiveUnitPrice(mapping.requestPrice, mapping.discount);
			return price ? price * 1000 : null;
		},
		format: formatUsd,
	},
	{
		key: "ocr",
		label: "OCR",
		unit: "$/1K pages",
		better: "low",
		value: ({ mapping }) => {
			const price = effectiveUnitPrice(mapping.ocrPagePrice, mapping.discount);
			return price ? price * 1000 : null;
		},
		format: formatUsd,
	},
	{
		key: "throughput",
		label: "Throughput",
		unit: "tok/s",
		better: "high",
		performance: true,
		value: (_, performance) => performance?.tokensPerSecond ?? null,
		format: (value) => formatNumber(value),
	},
	{
		key: "latency",
		label: "Latency",
		unit: "first token",
		better: "low",
		performance: true,
		value: (_, performance) => performance?.avgTimeToFirstToken ?? null,
		format: (value) => `${(value / 1000).toFixed(2)}s`,
	},
	{
		key: "uptime",
		label: "Uptime",
		unit: "24h",
		better: "high",
		performance: true,
		value: (_, performance) => performance?.uptime ?? null,
		format: (value) => `${value.toFixed(1)}%`,
	},
];

// Sort links shared before the table existed used these names.
const LEGACY_SORT_KEYS: Record<string, ColumnKey> = {
	"input-price": "input",
	"output-price": "output",
};

function parseSortKey(value: string | null): ColumnKey | null {
	if (value === null) {
		return null;
	}
	const key = LEGACY_SORT_KEYS[value] ?? value;
	return COLUMNS.some((column) => column.key === key)
		? (key as ColumnKey)
		: null;
}

const hasProviderStabilityWarning = (
	provider: ApiModelProviderMapping,
): boolean =>
	provider.stability !== null &&
	provider.stability !== undefined &&
	["unstable", "experimental"].includes(provider.stability);

export function ProviderComparisonTable({
	model,
}: {
	model: ModelWithProviders;
}) {
	const router = useRouter();
	const pathname = usePathname();
	const [copied, setCopied] = useState<string | null>(null);
	const [showDeactivated, setShowDeactivated] = useState(false);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [sort, setSort] = useState<{
		key: ColumnKey;
		reversed: boolean;
	} | null>(null);
	const { data: benchmarks, isLoading: benchmarksLoading } = useModelBenchmarks(
		model.id,
	);
	const isImageGen = model.output?.includes("image") ?? false;

	const changeSort = useCallback(
		(next: { key: ColumnKey; reversed: boolean } | null) => {
			setSort(next);
			const params = new URLSearchParams(window.location.search);
			params.delete("sort");
			params.delete("dir");
			if (next) {
				params.set("sort", next.key);
				if (next.reversed) {
					params.set("dir", "reversed");
				}
			}
			const query = params.toString();
			router.replace(query ? `${pathname}?${query}` : pathname, {
				scroll: false,
			});
		},
		[pathname, router],
	);

	// The page is statically generated, so the query string is only known on
	// the client: adopt a shared sort once after hydration instead of calling
	// useSearchParams, which would drop the table from the static HTML.
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const key = parseSortKey(params.get("sort"));
		if (key) {
			setSort({ key, reversed: params.get("dir") === "reversed" });
		}
	}, []);

	const copyToClipboard = useCallback((text: string) => {
		void navigator.clipboard.writeText(text);
		setCopied(text);
		setTimeout(() => setCopied(null), 2000);
	}, []);

	const deactivatedCount = useMemo(
		() =>
			model.providerDetails.filter(({ provider }) =>
				isMappingDeactivated(provider),
			).length,
		[model.providerDetails],
	);

	// Deactivated providers cannot serve requests, so they are hidden unless the
	// visitor asks for them. A model whose providers are all deactivated still
	// shows them, otherwise the table would be empty.
	const groups = useMemo(() => {
		const details =
			showDeactivated || deactivatedCount === model.providerDetails.length
				? model.providerDetails
				: model.providerDetails.filter(
						({ provider }) => !isMappingDeactivated(provider),
					);
		const map = new Map<string, Omit<ProviderGroup, "mapping">>();
		for (const { provider, providerInfo } of details) {
			const group = map.get(provider.providerId) ?? {
				providerInfo,
				providerId: provider.providerId,
				mappings: [],
			};
			group.mappings.push(provider);
			map.set(provider.providerId, group);
		}
		// Providers with a marketing badge first
		return Array.from(map.values())
			.map((group) => ({
				...group,
				mapping: getDefaultProviderMapping(group.mappings),
			}))
			.sort(
				(a, b) =>
					Number(Boolean(b.providerInfo?.modelCardBadge)) -
					Number(Boolean(a.providerInfo?.modelCardBadge)),
			);
	}, [model.providerDetails, showDeactivated, deactivatedCount]);

	// Performance is only trustworthy above the significance threshold;
	// providers below it show no data rather than a noisy number.
	const performanceByProvider = useMemo(() => {
		const map = new Map<string, ProviderPerformance>();
		for (const p of benchmarks?.providers ?? []) {
			if (p.logsCount >= MIN_SIGNIFICANT_REQUESTS) {
				map.set(p.providerId, p);
			}
		}
		return map;
	}, [benchmarks]);

	const valueOf = useCallback(
		(column: Column, group: ProviderGroup) =>
			column.value(group, performanceByProvider.get(group.providerId)),
		[performanceByProvider],
	);

	const columns = useMemo(
		() =>
			COLUMNS.filter(
				(column) =>
					column.performance ||
					groups.some((group) => {
						const value = valueOf(column, group);
						return value !== null && (value > 0 || model.free === true);
					}),
			),
		[groups, valueOf, model.free],
	);

	// The best value per column, only where providers actually differ.
	const bestByColumn = useMemo(() => {
		const best = new Map<ColumnKey, number>();
		for (const column of columns) {
			const values = groups
				.map((group) => valueOf(column, group))
				.filter((value): value is number => value !== null);
			if (new Set(values).size > 1) {
				best.set(
					column.key,
					column.better === "low" ? Math.min(...values) : Math.max(...values),
				);
			}
		}
		return best;
	}, [columns, groups, valueOf]);

	const sortColumn = sort
		? columns.find((column) => column.key === sort.key)
		: undefined;

	const sortedGroups = useMemo(() => {
		if (!sortColumn || !sort) {
			return groups;
		}
		const direction =
			(sortColumn.better === "low" ? 1 : -1) * (sort.reversed ? -1 : 1);
		return [...groups].sort((a, b) => {
			const aValue = valueOf(sortColumn, a);
			const bValue = valueOf(sortColumn, b);
			if (aValue === null || bValue === null) {
				return Number(aValue === null) - Number(bValue === null);
			}
			return (aValue - bValue) * direction;
		});
	}, [groups, sort, sortColumn, valueOf]);

	const toggleExpanded = (providerId: string) =>
		setExpanded((prev) => {
			const next = new Set(prev);
			if (!next.delete(providerId)) {
				next.add(providerId);
			}
			return next;
		});

	const canToggleDeactivated =
		deactivatedCount > 0 && deactivatedCount < model.providerDetails.length;
	const sortable = groups.length > 1;

	return (
		<TooltipProvider>
			<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
				<p className="text-sm text-muted-foreground">
					{groups.length} provider{groups.length === 1 ? "" : "s"}
					{sortable && (
						<>
							{" · "}
							{sortColumn ? (
								<>
									sorted by {sortColumn.label.toLowerCase()}{" "}
									<button
										type="button"
										onClick={() => changeSort(null)}
										className="underline underline-offset-4 hover:text-foreground"
									>
										reset
									</button>
								</>
							) : (
								"select a column to sort"
							)}
						</>
					)}
				</p>
				{canToggleDeactivated && (
					<Button
						variant="outline"
						size="sm"
						onClick={() => setShowDeactivated((prev) => !prev)}
					>
						<AlertCircle className="mr-1.5 h-3.5 w-3.5 text-red-500" />
						{showDeactivated
							? "Hide deactivated providers"
							: `Show ${deactivatedCount} deactivated provider${deactivatedCount === 1 ? "" : "s"}`}
					</Button>
				)}
			</div>

			<div className="overflow-x-auto rounded-xl border">
				<table className="w-full min-w-[720px] border-collapse text-sm">
					<thead>
						<tr className="border-b bg-muted/40 text-xs text-muted-foreground">
							<th
								scope="col"
								className="sticky left-0 z-10 bg-muted px-4 py-2.5 text-left font-medium"
							>
								Provider
							</th>
							{columns.map((column) => {
								const isSorted = sortColumn?.key === column.key;
								const ascending =
									(column.better === "low") !== (sort?.reversed ?? false);
								return (
									<th
										key={column.key}
										scope="col"
										aria-sort={
											isSorted
												? ascending
													? "ascending"
													: "descending"
												: undefined
										}
										className="whitespace-nowrap px-3 py-2.5 text-right font-medium"
									>
										<button
											type="button"
											disabled={!sortable}
											onClick={() =>
												changeSort({
													key: column.key,
													reversed: isSorted ? !sort!.reversed : false,
												})
											}
											className={cn(
												"inline-flex items-center gap-1 rounded-sm transition-colors enabled:hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
												isSorted && "text-foreground",
											)}
										>
											<span className="flex flex-col items-end leading-tight">
												{column.label}
												{column.unit && (
													<span className="text-[10px] font-normal text-muted-foreground/80">
														{column.unit}
													</span>
												)}
											</span>
											{isSorted &&
												(ascending ? (
													<ArrowUp className="h-3 w-3" />
												) : (
													<ArrowDown className="h-3 w-3" />
												))}
										</button>
									</th>
								);
							})}
							<th scope="col" className="w-20 px-3 py-2.5">
								<span className="sr-only">Actions</span>
							</th>
						</tr>
					</thead>
					<tbody>
						{sortedGroups.map((group) => {
							const { providerId, providerInfo, mapping, mappings } = group;
							const ProviderIcon = getProviderIcon(providerId);
							const brandUrl =
								providerInfo?.airsideIconUrl ?? providerInfo?.airsideLogoUrl;
							const isExpanded = expanded.has(providerId);
							const isDeactivated = isMappingDeactivated(mapping);
							const regionCount = mappings.filter((m) => m.region).length;
							const discount = mapping.discount
								? parseFloat(mapping.discount)
								: 0;
							const providerModelId = `${providerId}/${model.id}`;
							const detailsId = `provider-details-${providerId}`;

							return (
								<Fragment key={providerId}>
									<tr
										onClick={() => toggleExpanded(providerId)}
										className={cn(
											"group cursor-pointer border-b transition-colors last:border-b-0 hover:bg-muted/40",
											isExpanded && "bg-muted/30",
											isDeactivated && "opacity-60",
										)}
									>
										<th
											scope="row"
											className={cn(
												"sticky left-0 z-10 bg-background px-4 py-3 text-left font-normal transition-colors group-hover:bg-muted",
												isExpanded && "bg-muted",
											)}
										>
											<div className="flex items-center gap-2.5">
												{brandUrl ? (
													<CarrierMark
														src={brandUrl}
														className="h-5 w-5 shrink-0 object-contain"
													/>
												) : ProviderIcon ? (
													<ProviderIcon className="h-5 w-5 shrink-0" />
												) : (
													<Server className="h-5 w-5 shrink-0 text-muted-foreground" />
												)}
												<div className="min-w-0">
													<div className="flex items-center gap-1.5">
														<Link
															href={`/models/${encodeURIComponent(model.id)}/${encodeURIComponent(providerId)}`}
															onClick={(e) => e.stopPropagation()}
															className="truncate font-medium underline-offset-4 hover:underline"
														>
															{providerInfo?.name ?? providerId}
														</Link>
														{hasProviderStabilityWarning(mapping) && (
															<AlertTriangle
																className="h-3.5 w-3.5 shrink-0 text-orange-500"
																aria-label={`${mapping.stability} provider`}
															/>
														)}
													</div>
													<div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
														{providerInfo?.modelCardBadge && (
															<span>{providerInfo.modelCardBadge}</span>
														)}
														{regionCount > 1 && (
															<span>{regionCount} regions</span>
														)}
														{discount > 0 && (
															<span className="font-medium text-green-600">
																{Math.round(discount * 100)}% off
															</span>
														)}
														{isDeactivated && (
															<span className="text-red-500">Deactivated</span>
														)}
													</div>
												</div>
											</div>
										</th>
										{columns.map((column) => {
											const value = valueOf(column, group);
											const isBest =
												value !== null &&
												bestByColumn.get(column.key) === value;
											return (
												<td
													key={column.key}
													className={cn(
														"whitespace-nowrap px-3 py-3 text-right tabular-nums",
														isBest
															? "font-semibold text-emerald-600 dark:text-emerald-400"
															: value === null && "text-muted-foreground/60",
													)}
													title={
														isBest
															? `Best ${column.label.toLowerCase()} for this model`
															: undefined
													}
												>
													{value !== null ? (
														column.format(value)
													) : column.performance && benchmarksLoading ? (
														<span className="inline-block h-3 w-8 animate-pulse rounded bg-muted align-middle" />
													) : (
														"—"
													)}
												</td>
											);
										})}
										<td className="px-3 py-3">
											<div className="flex items-center justify-end gap-0.5">
												<Button
													variant="ghost"
													size="sm"
													className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
													aria-label={`Copy ${providerModelId}`}
													title={`Copy ${providerModelId}`}
													onClick={(e) => {
														e.stopPropagation();
														copyToClipboard(providerModelId);
													}}
												>
													{copied === providerModelId ? (
														<Check className="h-3.5 w-3.5 text-green-600" />
													) : (
														<Copy className="h-3.5 w-3.5" />
													)}
												</Button>
												<Button
													variant="ghost"
													size="sm"
													className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
													aria-expanded={isExpanded}
													aria-controls={detailsId}
													aria-label={`${isExpanded ? "Hide" : "Show"} ${providerInfo?.name ?? providerId} details`}
													onClick={(e) => {
														e.stopPropagation();
														toggleExpanded(providerId);
													}}
												>
													<ChevronDown
														className={cn(
															"h-4 w-4 transition-transform duration-200 motion-reduce:transition-none",
															isExpanded && "rotate-180",
														)}
													/>
												</Button>
											</div>
										</td>
									</tr>
									{isExpanded && (
										<tr id={detailsId} className="border-b last:border-b-0">
											<td
												colSpan={columns.length + 2}
												className="bg-muted/20 p-4"
											>
												<div className="sticky left-4 grid max-w-[calc(100vw-4rem)] gap-4 md:max-w-4xl md:grid-cols-[minmax(0,34rem)_minmax(0,16rem)]">
													<ProviderSection
														modelId={model.id}
														providerInfo={providerInfo}
														providerId={providerId}
														ProviderIcon={ProviderIcon}
														mappings={mappings}
														hasRegions={
															mappings.length > 1 || !!mappings[0].region
														}
														hasProviderStabilityWarning={
															hasProviderStabilityWarning
														}
														formatPrice={formatDetailPrice}
														copyToClipboard={copyToClipboard}
														copiedModel={copied}
														isImageGen={isImageGen}
														detailed
														providerHref={`/providers/${encodeURIComponent(providerId)}`}
													/>
													<div className="flex flex-col gap-2">
														<ModelCtaButton
															modelId={providerModelId}
															output={model.output}
														/>
														<Link
															href={`/models/${encodeURIComponent(model.id)}/${encodeURIComponent(providerId)}`}
															className="inline-flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
														>
															{model.name ?? model.id} on{" "}
															{providerInfo?.name ?? providerId}
															<ArrowUpRight className="h-4 w-4 shrink-0" />
														</Link>
														<Link
															href={`/providers/${encodeURIComponent(providerId)}`}
															className="inline-flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
														>
															All {providerInfo?.name ?? providerId} models
															<ArrowUpRight className="h-4 w-4 shrink-0" />
														</Link>
													</div>
												</div>
											</td>
										</tr>
									)}
								</Fragment>
							);
						})}
					</tbody>
				</table>
			</div>
			<p className="mt-2 text-xs text-muted-foreground">
				Prices are per provider at standard rates; open a row for regions, tiers
				and cache pricing. Throughput, latency and uptime come from LLM Gateway
				traffic over the last 24 hours and are hidden under{" "}
				{formatNumber(MIN_SIGNIFICANT_REQUESTS)} requests.
			</p>
		</TooltipProvider>
	);
}
