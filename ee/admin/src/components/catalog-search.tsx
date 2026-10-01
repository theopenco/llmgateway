"use client";

import { ChevronsUpDown, Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { useApi } from "@/lib/fetch-client";

import { getProviderIcon } from "@llmgateway/shared";

import type { CatalogSelection } from "@/lib/catalog-filters";

interface Suggestion {
	key: string;
	label: string;
	sublabel?: string;
	providerId?: string;
	modelId?: string;
}

const SELECTION_PARAMS = ["search", "providerId", "modelId"] as const;
const MAX_SUGGESTIONS = 50;

function matches(term: string, ...fields: string[]) {
	return fields.some((field) => field.toLowerCase().includes(term));
}

/** Exact matches first, then prefixes, then any other substring match. */
function matchRank(label: string, term: string) {
	const value = label.toLowerCase();
	return value === term ? 0 : value.startsWith(term) ? 1 : 2;
}

function ProviderIcon({ provider }: { provider: string }) {
	const Icon = getProviderIcon(provider);
	return <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />;
}

/**
 * Free-text search with autocomplete for the catalogue lists. Typed text
 * stays a substring search; picking a suggestion narrows to that exact model,
 * provider or mapping. The selection lives in the URL.
 */
export function CatalogSearch({
	scope,
	selection,
}: {
	/** `models` suggests models only; `mappings` adds providers and mappings. */
	scope: "models" | "mappings";
	selection: CatalogSelection;
}) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const [open, setOpen] = useState(false);
	const [input, setInput] = useState("");
	const $api = useApi();
	const { data, isLoading } = $api.useQuery(
		"get",
		"/admin/rate-limits/options",
		{},
		{ enabled: open },
	);

	const term = input.trim();
	const groups = useMemo(() => {
		const needle = term.toLowerCase();
		const models = new Map<string, Suggestion>();
		const mappings = new Map<string, Suggestion>();
		for (const mapping of data?.mappings ?? []) {
			if (
				!models.has(mapping.modelId) &&
				matches(needle, mapping.modelId, mapping.modelName)
			) {
				models.set(mapping.modelId, {
					key: `model:${mapping.modelId}`,
					label: mapping.modelId,
					sublabel:
						mapping.modelName === mapping.modelId
							? undefined
							: mapping.modelName,
					modelId: mapping.modelId,
				});
			}
			const id = `${mapping.providerId}/${mapping.modelId}`;
			if (scope === "mappings" && !mappings.has(id) && matches(needle, id)) {
				mappings.set(id, {
					key: `mapping:${id}`,
					label: id,
					providerId: mapping.providerId,
					modelId: mapping.modelId,
				});
			}
		}
		const providers: Suggestion[] =
			scope === "mappings"
				? (data?.providers ?? [])
						.filter((provider) => matches(needle, provider.id, provider.name))
						.map((provider) => ({
							key: `provider:${provider.id}`,
							label: provider.id,
							sublabel: provider.name,
							providerId: provider.id,
						}))
				: [];
		return [
			{ heading: "Providers", items: providers },
			{ heading: "Models", items: Array.from(models.values()) },
			{ heading: "Mappings", items: Array.from(mappings.values()) },
		]
			.filter((group) => group.items.length > 0)
			.map((group) => ({
				...group,
				items: group.items
					.sort(
						(a, b) =>
							matchRank(a.label, needle) - matchRank(b.label, needle) ||
							a.label.localeCompare(b.label),
					)
					.slice(0, MAX_SUGGESTIONS),
			}));
	}, [data, scope, term]);

	const apply = (next: CatalogSelection) => {
		const params = new URLSearchParams(searchParams.toString());
		params.delete("page");
		for (const key of SELECTION_PARAMS) {
			const value = next[key];
			if (value) {
				params.set(key, value);
			} else {
				params.delete(key);
			}
		}
		const query = params.toString();
		router.replace(query ? `${pathname}?${query}` : pathname, {
			scroll: false,
		});
		setOpen(false);
		setInput("");
	};

	const exact =
		selection.providerId && selection.modelId
			? `${selection.providerId}/${selection.modelId}`
			: (selection.modelId ?? selection.providerId);
	const hasSelection = Boolean(exact ?? selection.search);
	const placeholder =
		scope === "models"
			? "Search by name or ID..."
			: "Search by model or provider...";

	return (
		<div className="flex w-full items-center gap-1 sm:w-auto">
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button
						variant="outline"
						size="sm"
						role="combobox"
						aria-expanded={open}
						aria-label={placeholder}
						className="h-9 min-w-0 flex-1 justify-start gap-2 px-3 font-normal sm:w-72 sm:flex-none"
					>
						<Search
							className="h-4 w-4 shrink-0 text-muted-foreground"
							aria-hidden
						/>
						{exact ? (
							<span className="truncate font-mono text-xs">{exact}</span>
						) : selection.search ? (
							<span className="truncate">&ldquo;{selection.search}&rdquo;</span>
						) : (
							<span className="truncate text-muted-foreground">
								{placeholder}
							</span>
						)}
						<ChevronsUpDown
							className="ml-auto h-3.5 w-3.5 shrink-0 opacity-50"
							aria-hidden
						/>
					</Button>
				</PopoverTrigger>
				<PopoverContent className="w-[360px] p-0" align="end">
					{/* Rows are matched and capped above; the built-in fuzzy filter
					    would also hide the free-text row. */}
					<Command shouldFilter={false}>
						<CommandInput
							placeholder={placeholder}
							value={input}
							onValueChange={setInput}
						/>
						<CommandList>
							{term === "" && groups.length === 0 && (
								<CommandEmpty>
									{isLoading ? "Loading…" : "No matches."}
								</CommandEmpty>
							)}
							{term !== "" && (
								<CommandGroup>
									<CommandItem
										value={`free-text:${term}`}
										onSelect={() => apply({ search: term })}
									>
										<Search className="mr-2 h-4 w-4 shrink-0" aria-hidden />
										<span className="truncate">
											Search all matching &ldquo;{term}&rdquo;
										</span>
									</CommandItem>
								</CommandGroup>
							)}
							{groups.map((group) => (
								<CommandGroup key={group.heading} heading={group.heading}>
									{group.items.map((item) => (
										<CommandItem
											key={item.key}
											value={item.key}
											onSelect={() =>
												apply({
													providerId: item.providerId,
													modelId: item.modelId,
												})
											}
										>
											{item.providerId ? (
												<ProviderIcon provider={item.providerId} />
											) : null}
											<span
												className={
													item.providerId
														? "ml-2 flex min-w-0 flex-col"
														: "flex min-w-0 flex-col"
												}
											>
												<span className="truncate">{item.label}</span>
												{item.sublabel ? (
													<span className="truncate text-xs text-muted-foreground">
														{item.sublabel}
													</span>
												) : null}
											</span>
										</CommandItem>
									))}
								</CommandGroup>
							))}
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
			{hasSelection && (
				<Button
					type="button"
					variant="ghost"
					size="sm"
					aria-label="Clear search"
					className="h-9 px-2"
					onClick={() => apply({})}
				>
					<X className="h-4 w-4" />
				</Button>
			)}
		</div>
	);
}
