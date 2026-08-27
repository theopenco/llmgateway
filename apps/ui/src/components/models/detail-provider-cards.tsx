"use client";

import { motion, useReducedMotion } from "framer-motion";
import { AlertCircle, ArrowUpDown, Zap } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ModelCtaButton } from "@/components/models/model-cta-button";
import { Button } from "@/lib/components/button";
import { TooltipProvider } from "@/lib/components/tooltip";
import {
	MIN_SIGNIFICANT_REQUESTS,
	useModelBenchmarks,
} from "@/lib/use-model-benchmarks";
import { cn } from "@/lib/utils";

import {
	getProviderIcon,
	isMappingDeactivated,
} from "@llmgateway/shared/components";

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
}

const SORT_KEYS = [
	"featured",
	"input-price",
	"output-price",
	"throughput",
	"context",
] as const;

type SortKey = (typeof SORT_KEYS)[number];

const SORT_LABELS: Record<SortKey, string> = {
	featured: "Featured",
	"input-price": "Cheapest input",
	"output-price": "Cheapest output",
	throughput: "Fastest",
	context: "Most context",
};

function isSortKey(value: string | null): value is SortKey {
	return SORT_KEYS.includes(value as SortKey);
}

function effectivePrice(
	price: string | null | undefined,
	discount: string | null | undefined,
): number | null {
	if (price === null || price === undefined) {
		return null;
	}
	const priceNum = parseFloat(price);
	if (!Number.isFinite(priceNum)) {
		return null;
	}
	const discountNum = discount ? parseFloat(discount) : 0;
	return priceNum * (1 - (Number.isFinite(discountNum) ? discountNum : 0));
}

// Sort values mirror what each card displays by default: the first (default
// region) mapping, at peak pricing for mappings with a time-based schedule.
// Sorting on a cheaper secondary region or off-peak price would contradict the
// numbers the visitor sees.
function groupSortValue(
	group: ProviderGroup,
	sort: SortKey,
	throughputByProvider: Map<string, number>,
): number | null {
	const mapping = group.mappings[0];
	switch (sort) {
		case "input-price":
			return effectivePrice(
				mapping.peakPricing?.peak.inputPrice ?? mapping.inputPrice,
				mapping.discount,
			);
		case "output-price":
			return effectivePrice(
				mapping.peakPricing?.peak.outputPrice ?? mapping.outputPrice,
				mapping.discount,
			);
		case "throughput":
			return throughputByProvider.get(group.providerId) ?? null;
		case "context":
			return mapping.contextSize ?? null;
		default:
			return null;
	}
}

export function DetailProviderCards({ model }: { model: ModelWithProviders }) {
	const router = useRouter();
	const pathname = usePathname();
	const prefersReducedMotion = useReducedMotion();
	const [copiedModel, setCopiedModel] = useState<string | null>(null);
	const [showDeactivated, setShowDeactivated] = useState(false);
	const [sort, setSort] = useState<SortKey>("featured");
	const {
		data: benchmarks,
		isFetched: benchmarksFetched,
		isError: benchmarksErrored,
	} = useModelBenchmarks(model.id);
	const isImageGen = Array.isArray(model.output)
		? model.output.includes("image")
		: false;

	// The page is statically generated, so the query string is only known on the
	// client: adopt the shared sort once after hydration instead of calling
	// useSearchParams, which would drop the provider cards from the static HTML.
	useEffect(() => {
		const param = new URLSearchParams(window.location.search).get("sort");
		if (isSortKey(param)) {
			setSort(param);
		}
	}, []);

	const changeSort = useCallback(
		(key: SortKey) => {
			setSort(key);
			const params = new URLSearchParams(window.location.search);
			if (key === "featured") {
				params.delete("sort");
			} else {
				params.set("sort", key);
			}
			const query = params.toString();
			router.replace(query ? `${pathname}?${query}` : pathname, {
				scroll: false,
			});
		},
		[pathname, router],
	);

	const copyToClipboard = (text: string) => {
		void navigator.clipboard.writeText(text);
		setCopiedModel(text);
		setTimeout(() => setCopiedModel(null), 2000);
	};

	const formatPrice = (
		price: string | null | undefined,
		discount?: string | null,
		align: "center" | "end" = "center",
		multiplier = 1,
	) => {
		if (price === null || price === undefined) {
			return "—";
		}
		const priceNum = parseFloat(price) * multiplier;
		const discountNum = discount ? parseFloat(discount) : 0;
		const originalPrice = parseFloat((priceNum * 1e6).toFixed(4));
		if (discountNum > 0) {
			const discountedPrice = parseFloat(
				(priceNum * 1e6 * (1 - discountNum)).toFixed(4),
			);
			return (
				<div
					className={`flex items-center gap-1 ${align === "end" ? "justify-end" : "justify-center"}`}
				>
					<span className="line-through text-muted-foreground text-xs">
						${originalPrice}
					</span>
					<span className="text-green-600 font-semibold">
						${discountedPrice}
					</span>
				</div>
			);
		}
		return `$${originalPrice}`;
	};

	const hasProviderStabilityWarning = (
		provider: ApiModelProviderMapping,
	): boolean => {
		return (
			provider.stability !== null &&
			provider.stability !== undefined &&
			["unstable", "experimental"].includes(provider.stability)
		);
	};

	const deactivatedCount = useMemo(
		() =>
			model.providerDetails.filter(({ provider }) =>
				isMappingDeactivated(provider),
			).length,
		[model.providerDetails],
	);

	// Deactivated providers cannot serve requests, so they are hidden unless the
	// visitor asks for them. A model whose providers are all deactivated still
	// shows them, otherwise the page would render an empty grid.
	const visibleProviderDetails = useMemo(() => {
		if (showDeactivated || deactivatedCount === model.providerDetails.length) {
			return model.providerDetails;
		}
		return model.providerDetails.filter(
			({ provider }) => !isMappingDeactivated(provider),
		);
	}, [model.providerDetails, showDeactivated, deactivatedCount]);

	// Group by provider ID so regions show as tabs within one card
	const groupedByProvider = useMemo(() => {
		const map = new Map<string, ProviderGroup>();
		for (const { provider, providerInfo } of visibleProviderDetails) {
			const key = provider.providerId;
			if (!map.has(key)) {
				map.set(key, {
					providerInfo,
					providerId: key,
					mappings: [],
				});
			}
			map.get(key)!.mappings.push(provider);
		}
		// Providers with a marketing badge (e.g. SCX.ai "Up to 4x faster") first
		return Array.from(map.values()).sort(
			(a, b) =>
				Number(Boolean(b.providerInfo?.modelCardBadge)) -
				Number(Boolean(a.providerInfo?.modelCardBadge)),
		);
	}, [visibleProviderDetails]);

	// Throughput is only trustworthy above the significance threshold; providers
	// below it sort as "no data" rather than on a noisy number.
	const throughputByProvider = useMemo(() => {
		const map = new Map<string, number>();
		for (const p of benchmarks?.providers ?? []) {
			if (
				p.logsCount >= MIN_SIGNIFICANT_REQUESTS &&
				p.tokensPerSecond !== null
			) {
				map.set(p.providerId, p.tokensPerSecond);
			}
		}
		return map;
	}, [benchmarks]);

	const availableSortKeys = useMemo(
		() =>
			SORT_KEYS.filter(
				(key) =>
					key === "featured" ||
					groupedByProvider.some(
						(group) =>
							groupSortValue(group, key, throughputByProvider) !== null,
					),
			),
		[groupedByProvider, throughputByProvider],
	);

	const activeSort = availableSortKeys.includes(sort) ? sort : "featured";

	// A requested sort with nothing to sort on (e.g. a shared ?sort=throughput
	// link for a model without benchmark data) falls back to featured; sync the
	// state and URL so the link names the order actually shown. Throughput
	// availability is only known once the benchmarks query settles, so leave
	// the URL untouched until then.
	useEffect(() => {
		if (sort === "featured" || availableSortKeys.includes(sort)) {
			return;
		}
		if (sort === "throughput" && !benchmarksFetched && !benchmarksErrored) {
			return;
		}
		changeSort("featured");
	}, [
		sort,
		availableSortKeys,
		benchmarksFetched,
		benchmarksErrored,
		changeSort,
	]);

	const sortedGroups = useMemo(() => {
		if (activeSort === "featured") {
			return groupedByProvider;
		}
		// Prices sort ascending (cheapest first); throughput and context
		// descending (best first). Providers without a value go last.
		const direction =
			activeSort === "input-price" || activeSort === "output-price" ? 1 : -1;
		return [...groupedByProvider].sort((a, b) => {
			const aValue = groupSortValue(a, activeSort, throughputByProvider);
			const bValue = groupSortValue(b, activeSort, throughputByProvider);
			if (aValue === null && bValue === null) {
				return 0;
			}
			if (aValue === null) {
				return 1;
			}
			if (bValue === null) {
				return -1;
			}
			return (aValue - bValue) * direction;
		});
	}, [groupedByProvider, activeSort, throughputByProvider]);

	const canToggleDeactivated =
		deactivatedCount > 0 && deactivatedCount < model.providerDetails.length;

	const showSortControl = groupedByProvider.length > 1;

	return (
		<TooltipProvider>
			{(showSortControl || canToggleDeactivated) && (
				<div className="mb-4 flex flex-wrap items-center justify-between gap-2">
					{showSortControl ? (
						<div
							role="group"
							aria-label="Sort providers"
							className="flex h-8 w-fit max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-border/50 bg-muted/30 p-0.5"
						>
							<ArrowUpDown className="mx-1.5 h-3 w-3 shrink-0 text-muted-foreground/60" />
							{availableSortKeys.map((key) => {
								const isActive = activeSort === key;
								return (
									<button
										key={key}
										type="button"
										onClick={() => changeSort(key)}
										aria-pressed={isActive}
										className={cn(
											"inline-flex h-6.5 shrink-0 items-center whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.97]",
											isActive
												? "border border-border/50 bg-background text-foreground shadow-sm"
												: "text-muted-foreground hover:text-foreground",
										)}
									>
										{SORT_LABELS[key]}
									</button>
								);
							})}
						</div>
					) : (
						<div />
					)}
					{canToggleDeactivated && (
						<Button
							variant="outline"
							size="sm"
							onClick={() => setShowDeactivated((prev) => !prev)}
						>
							<AlertCircle className="h-3.5 w-3.5 mr-1.5 text-red-500" />
							{showDeactivated
								? "Hide deactivated providers"
								: `Show ${deactivatedCount} deactivated provider${deactivatedCount === 1 ? "" : "s"}`}
						</Button>
					)}
				</div>
			)}
			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
				{sortedGroups.map(({ providerInfo, providerId, mappings }) => {
					const ProviderIcon = getProviderIcon(providerId);
					const hasRegions =
						mappings.length > 1 ||
						(mappings.length === 1 && !!mappings[0].region);
					const throughput = throughputByProvider.get(providerId);

					return (
						<motion.div
							key={providerId}
							layout={prefersReducedMotion ? false : "position"}
							transition={{ type: "spring", duration: 0.45, bounce: 0.15 }}
							className="flex h-full flex-col gap-3"
						>
							<ProviderSection
								modelId={model.id}
								providerInfo={providerInfo}
								providerId={providerId}
								ProviderIcon={ProviderIcon}
								mappings={mappings}
								hasRegions={hasRegions}
								hasProviderStabilityWarning={hasProviderStabilityWarning}
								formatPrice={formatPrice}
								copyToClipboard={copyToClipboard}
								copiedModel={copiedModel}
								isImageGen={isImageGen}
								detailed
								providerHref={`/providers/${encodeURIComponent(providerId)}`}
								headerExtra={
									activeSort === "throughput" &&
									throughput !== undefined && (
										<span className="inline-flex h-4 shrink-0 items-center gap-1 whitespace-nowrap rounded border border-border/50 bg-background/80 px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground">
											<Zap className="h-2.5 w-2.5 text-amber-500" />
											{throughput.toLocaleString()} tok/s
										</span>
									)
								}
							/>
							<ModelCtaButton
								modelId={`${providerId}/${model.id}`}
								output={model.output}
							/>
						</motion.div>
					);
				})}
			</div>
		</TooltipProvider>
	);
}
