"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/lib/components/command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/lib/components/popover";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import {
	formatMonthLabel,
	MODEL_SEARCH_PAGE_SIZE,
	searchMatchRanges,
} from "@llmgateway/shared";
import {
	getModelFamilyIcon,
	getProviderIcon,
} from "@llmgateway/shared/components";

import type { paths } from "@/lib/api/v1";
import type { ReactNode } from "react";

type ModelSearchResponse =
	paths["/internal/models/search"]["get"]["responses"][200]["content"]["application/json"];
type ModelSearchResult = ModelSearchResponse["models"][number];

interface ModelSearchGroup {
	key: string;
	heading: string;
	models: ModelSearchResult[];
}

const SEARCH_DEBOUNCE_MS = 150;

function useDebouncedValue(value: string, delay: number) {
	const [debouncedValue, setDebouncedValue] = useState(value);

	useEffect(() => {
		const timeout = window.setTimeout(() => setDebouncedValue(value), delay);
		return () => window.clearTimeout(timeout);
	}, [delay, value]);

	return debouncedValue;
}

export function SearchHighlight({
	text,
	query,
}: {
	text: string;
	query: string;
}) {
	const ranges = useMemo(() => searchMatchRanges(text, query), [text, query]);
	if (ranges.length === 0) {
		return <>{text}</>;
	}
	const parts: ReactNode[] = [];
	let last = 0;
	for (const [start, end] of ranges) {
		if (start > last) {
			parts.push(text.slice(last, start));
		}
		parts.push(
			<mark
				key={start}
				className="rounded-sm bg-primary/15 px-0.5 text-inherit"
			>
				{text.slice(start, end)}
			</mark>,
		);
		last = end;
	}
	if (last < text.length) {
		parts.push(text.slice(last));
	}
	return <>{parts}</>;
}

export function ModelSearch() {
	const router = useRouter();
	const api = useApi();
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const query = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
	const listRef = useRef<HTMLDivElement>(null);
	const sentinelRef = useRef<HTMLDivElement>(null);

	// One page at a time: the palette walks the catalogue month by month (or
	// by relevance while typing) and loads the next page as the list scrolls,
	// so opening it never downloads the full catalogue.
	const {
		data,
		isPending,
		isPlaceholderData,
		isFetchingNextPage,
		hasNextPage,
		fetchNextPage,
	} = api.useInfiniteQuery(
		"get",
		"/internal/models/search",
		{
			params: {
				query: { q: query || undefined, limit: MODEL_SEARCH_PAGE_SIZE },
			},
		},
		{
			enabled: open,
			initialPageParam: "",
			pageParamName: "cursor",
			getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
			placeholderData: keepPreviousData,
			staleTime: 60 * 1000,
		},
	);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				const target = event.target as HTMLElement | null;
				const isTypingElement =
					target &&
					(target.tagName === "INPUT" ||
						target.tagName === "TEXTAREA" ||
						target.isContentEditable);

				if (!isTypingElement) {
					event.preventDefault();
					setOpen(true);
				}
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);

	useEffect(() => {
		if (listRef.current) {
			listRef.current.scrollTop = 0;
		}
	}, [query]);

	const models = useMemo(
		() => data?.pages.flatMap((page) => page?.models ?? []) ?? [],
		[data],
	);
	const firstPage = data?.pages[0];
	const providers = firstPage?.providers ?? [];
	const total = firstPage?.total ?? 0;
	const groupedByMonth = firstPage?.groupedByMonth ?? true;

	const groups = useMemo<ModelSearchGroup[]>(() => {
		if (!groupedByMonth) {
			return models.length > 0
				? [
						{
							key: "matches",
							heading: total === 1 ? "1 match" : `${total} matches`,
							models,
						},
					]
				: [];
		}
		const byMonth: ModelSearchGroup[] = [];
		for (const model of models) {
			const last = byMonth[byMonth.length - 1];
			if (last && last.key === model.monthKey) {
				last.models.push(model);
			} else {
				byMonth.push({
					key: model.monthKey,
					heading: model.monthLabel,
					models: [model],
				});
			}
		}
		return byMonth;
	}, [groupedByMonth, models, total]);

	// Load the next page once the end of the list scrolls into view. The list
	// is the scroll root, so this also fires when arrow keys walk past the
	// last loaded item.
	useEffect(() => {
		const root = listRef.current;
		const target = sentinelRef.current;
		if (!open || !root || !target || !hasNextPage) {
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					void fetchNextPage();
				}
			},
			{ root, rootMargin: "0px 0px 160px 0px" },
		);
		observer.observe(target);
		return () => observer.disconnect();
	}, [open, hasNextPage, fetchNextPage, groups.length]);

	const status = isFetchingNextPage
		? "loading"
		: hasNextPage
			? "more"
			: models.length > 0
				? "done"
				: null;

	return (
		<Popover
			open={open}
			onOpenChange={(v) => {
				setOpen(v);
				if (!v) {
					setSearch("");
				}
			}}
		>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="flex w-full items-center gap-2 rounded-full border border-border bg-background/60 px-3 py-1.5 text-xs text-muted-foreground shadow-sm transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
				>
					<Search className="h-3.5 w-3.5 shrink-0" />
					<span className="truncate">
						Search models by provider, name, ID, or alias…
					</span>
					<span className="ml-auto hidden rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-flex">
						⌘K
					</span>
				</button>
			</PopoverTrigger>
			<PopoverContent
				className="w-[min(480px,90vw)] p-0"
				side="bottom"
				align="center"
			>
				<Command shouldFilter={false}>
					<CommandInput
						placeholder="Search models…"
						value={search}
						onValueChange={setSearch}
					/>
					<CommandList
						ref={listRef}
						data-testid="model-search-list"
						className={cn(
							"max-h-[400px] transition-opacity",
							isPlaceholderData && "opacity-60",
						)}
					>
						<CommandEmpty>
							{isPending ? "Loading models…" : "No results found."}
						</CommandEmpty>
						{providers.length > 0 && (
							<CommandGroup heading="Providers">
								{providers.map((p) => {
									const ProviderIcon = getProviderIcon(p.id);
									return (
										<CommandItem
											key={`provider-${p.id}`}
											value={`provider-${p.id}`}
											onSelect={() => {
												router.push(`/providers/${encodeURIComponent(p.id)}`);
												setOpen(false);
											}}
										>
											<div className="flex items-center gap-3">
												<div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted">
													{ProviderIcon ? (
														<ProviderIcon className="h-5 w-5" />
													) : (
														<span className="text-xs font-medium uppercase text-muted-foreground">
															{p.name.charAt(0)}
														</span>
													)}
												</div>
												<div className="flex flex-col items-start">
													<span className="text-sm font-medium">
														<SearchHighlight text={p.name} query={query} />
													</span>
													<span className="text-xs text-muted-foreground">
														{p.id}
													</span>
												</div>
											</div>
										</CommandItem>
									);
								})}
							</CommandGroup>
						)}
						{groups.map((group) => (
							<CommandGroup key={group.key} heading={group.heading}>
								{group.models.map((model) => {
									const FamilyIcon = getModelFamilyIcon(model.family);

									return (
										<CommandItem
											key={model.id}
											value={model.id}
											onSelect={() => {
												router.push(`/models/${encodeURIComponent(model.id)}`);
												setOpen(false);
											}}
										>
											<div className="flex w-full min-w-0 items-center gap-3">
												<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
													<FamilyIcon className="h-5 w-5" />
												</div>
												<div className="flex min-w-0 flex-col items-start">
													<span className="max-w-full truncate text-sm font-medium">
														<SearchHighlight text={model.name} query={query} />
													</span>
													<span className="max-w-full truncate text-xs text-muted-foreground">
														<SearchHighlight text={model.id} query={query} />
													</span>
												</div>
												<div className="ml-auto flex shrink-0 items-center gap-1.5">
													{model.free && (
														<span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
															Free
														</span>
													)}
													{!groupedByMonth && (
														<span className="text-[10px] text-muted-foreground">
															{formatMonthLabel(model.monthKey, "short")}
														</span>
													)}
												</div>
											</div>
										</CommandItem>
									);
								})}
							</CommandGroup>
						))}
						{status && (
							<div
								ref={sentinelRef}
								data-testid="model-search-status"
								className="px-2 py-2 text-center text-[11px] text-muted-foreground"
							>
								{status === "loading" ? (
									<span className="inline-flex items-center gap-1.5">
										<Loader2 className="h-3 w-3 animate-spin" />
										Loading more…
									</span>
								) : status === "more" ? (
									`${models.length} of ${total} models · scroll for more`
								) : (
									`All ${total} models`
								)}
							</div>
						)}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
