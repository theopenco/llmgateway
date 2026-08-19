"use client";

import { AlertTriangle, Check, ChevronsUpDown, Sparkles } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

import {
	formatMappingValue,
	getModelMappings,
	getModelName,
	getProviderName,
	isDeactivated,
	isUnstableStability,
	parseMappingValue,
} from "./model-entries";
import { getProviderIcon } from "./provider-icons";
import { Button } from "./ui/button";
import {
	Command,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "./ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

import type {
	UnifiedMapping,
	UnifiedModel,
	UnifiedProvider,
} from "./model-entries";

interface ModelMappingSelectorProps {
	models: readonly UnifiedModel[];
	providers: readonly UnifiedProvider[];
	/**
	 * `provider/model` for a mapping, or a bare `model` id for a root model
	 * entry. A bare id still renders correctly even with `includeRootModels`
	 * off, so pre-existing links keep working.
	 */
	value?: string | null;
	onValueChange: (value: string) => void;
	placeholder?: string;
	/** Also offer the model itself (auto-routed across all of its providers). */
	includeRootModels?: boolean;
	/** Offer one entry per region instead of one entry per provider. */
	includeRegions?: boolean;
	/** Include mappings whose `deactivatedAt` has passed. */
	includeDeactivated?: boolean;
	/** Narrow the offered mappings, e.g. to models with more than one provider. */
	filter?: (entry: {
		model: UnifiedModel;
		mapping?: UnifiedMapping;
	}) => boolean;
	/**
	 * Rendering thousands of mappings at once is slow; the list is capped and a
	 * hint to refine the search is shown instead.
	 */
	maxResults?: number;
	className?: string;
	contentClassName?: string;
	align?: "start" | "center" | "end";
	disabled?: boolean;
}

interface MappingEntry {
	value: string;
	model: UnifiedModel;
	mapping?: UnifiedMapping;
	provider?: UnifiedProvider;
	searchText: string;
}

function normalize(value: string): string {
	return value.toLowerCase().replace(/[-_\s.]+/g, "");
}

function EntryIcon({
	entry,
	className,
}: {
	entry: Pick<MappingEntry, "mapping">;
	className?: string;
}) {
	if (!entry.mapping) {
		return <Sparkles className={cn("text-primary", className)} />;
	}
	const Icon = getProviderIcon(entry.mapping.providerId);
	return <Icon className={className} />;
}

export function ModelMappingSelector({
	models,
	providers,
	value,
	onValueChange,
	placeholder = "Select a mapping…",
	includeRootModels = false,
	includeRegions = false,
	includeDeactivated = false,
	filter,
	maxResults = 100,
	className,
	contentClassName,
	align = "start",
	disabled,
}: ModelMappingSelectorProps) {
	const [open, setOpen] = React.useState(false);
	const [search, setSearch] = React.useState("");
	const deferredSearch = React.useDeferredValue(search);

	const entries = React.useMemo(() => {
		const now = new Date();
		const out: MappingEntry[] = [];
		// The catalogue holds thousands of mappings, so resolve providers through
		// a lookup instead of scanning the provider list per mapping.
		const providerById = new Map(providers.map((p) => [p.id, p]));

		for (const model of [...models].sort((a, b) => a.id.localeCompare(b.id))) {
			const modelName = getModelName(model);

			if (includeRootModels && (!filter || filter({ model }))) {
				out.push({
					value: model.id,
					model,
					searchText: normalize(`${modelName} ${model.id} auto`),
				});
			}

			for (const mapping of getModelMappings(model)) {
				if (!includeDeactivated && isDeactivated(mapping.deactivatedAt, now)) {
					continue;
				}
				if (filter && !filter({ model, mapping })) {
					continue;
				}
				const provider = providerById.get(mapping.providerId);
				out.push({
					value: formatMappingValue(
						mapping.providerId,
						model.id,
						includeRegions ? mapping.region : null,
					),
					model,
					mapping,
					provider,
					searchText: normalize(
						`${modelName} ${model.id} ${mapping.providerId} ${getProviderName(provider)} ${mapping.region ?? ""}`,
					),
				});
			}
		}

		// One entry per provider unless regional variants were requested.
		if (includeRegions) {
			return out;
		}
		const seen = new Set<string>();
		return out.filter((entry) => {
			if (seen.has(entry.value)) {
				return false;
			}
			seen.add(entry.value);
			return true;
		});
	}, [
		models,
		providers,
		includeRootModels,
		includeRegions,
		includeDeactivated,
		filter,
	]);

	const filteredEntries = React.useMemo(() => {
		const tokens = deferredSearch
			.toLowerCase()
			.split(/[-_\s.]+/)
			.filter(Boolean);
		if (tokens.length === 0) {
			return entries;
		}
		return entries.filter((entry) =>
			tokens.every((token) => entry.searchText.includes(token)),
		);
	}, [entries, deferredSearch]);

	const visibleEntries = filteredEntries.slice(0, maxResults);
	const hiddenCount = filteredEntries.length - visibleEntries.length;

	const selected = React.useMemo(() => {
		if (!value) {
			return null;
		}
		const exact = entries.find((entry) => entry.value === value);
		if (exact) {
			return exact;
		}
		// The value may point at a mapping that is filtered out (deactivated,
		// unknown provider) or at a bare model id while root entries are off.
		const parsed = parseMappingValue(value);
		const model = models.find((m) => m.id === parsed.modelId);
		if (!model) {
			return null;
		}
		const mapping = parsed.providerId
			? getModelMappings(model).find((m) => m.providerId === parsed.providerId)
			: undefined;
		return {
			value,
			model,
			mapping,
			provider: providers.find((p) => p.id === parsed.providerId),
			searchText: "",
		} satisfies MappingEntry;
	}, [entries, models, providers, value]);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					role="combobox"
					aria-expanded={open}
					disabled={disabled}
					className={cn("w-[320px] justify-between", className)}
				>
					{selected ? (
						<span className="flex min-w-0 items-center gap-2">
							<EntryIcon entry={selected} className="h-4 w-4 shrink-0" />
							<span className="truncate font-medium">
								{getModelName(selected.model)}
							</span>
							<span className="truncate text-xs text-muted-foreground">
								{selected.mapping
									? getProviderName(selected.provider) ||
										selected.mapping.providerId
									: "All providers"}
							</span>
						</span>
					) : (
						<span className="truncate text-muted-foreground">
							{placeholder}
						</span>
					)}
					<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				className={cn("w-[380px] p-0", contentClassName)}
				align={align}
			>
				<Command shouldFilter={false}>
					<CommandInput
						placeholder="Search model or provider…"
						value={search}
						onValueChange={setSearch}
					/>
					<CommandList>
						{/* Searching happens here, not in cmdk (shouldFilter={false}), so
						    cmdk's own CommandEmpty would never see an empty result set. */}
						{visibleEntries.length === 0 ? (
							<div className="py-6 text-center text-sm text-muted-foreground">
								No mappings found.
							</div>
						) : null}
						<CommandGroup>
							{visibleEntries.map((entry) => {
								const unstable =
									isUnstableStability(entry.mapping?.stability) ||
									isUnstableStability(entry.model.stability);
								return (
									<CommandItem
										key={entry.value}
										value={entry.value}
										onSelect={() => {
											onValueChange(entry.value);
											setOpen(false);
										}}
										className="gap-2"
									>
										<Check
											className={cn(
												"h-4 w-4 shrink-0",
												value === entry.value ? "opacity-100" : "opacity-0",
											)}
										/>
										<EntryIcon entry={entry} className="h-4 w-4 shrink-0" />
										<span className="flex min-w-0 flex-col">
											<span className="flex items-center gap-1">
												<span className="truncate font-medium">
													{getModelName(entry.model)}
												</span>
												{unstable ? (
													<AlertTriangle className="h-3.5 w-3.5 shrink-0 text-yellow-600 dark:text-yellow-500" />
												) : null}
											</span>
											<span className="truncate font-mono text-[11px] text-muted-foreground">
												{entry.value}
											</span>
										</span>
										{entry.mapping ? (
											<span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">
												{getProviderName(entry.provider) ||
													entry.mapping.providerId}
											</span>
										) : (
											<span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">
												{getModelMappings(entry.model).length}p
											</span>
										)}
									</CommandItem>
								);
							})}
						</CommandGroup>
						{hiddenCount > 0 ? (
							<div className="border-t px-3 py-2 text-xs text-muted-foreground">
								{hiddenCount} more — refine your search.
							</div>
						) : null}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
