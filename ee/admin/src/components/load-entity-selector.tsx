"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

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
import { cn } from "@/lib/utils";

import type { LucideIcon } from "lucide-react";

export type LoadFilterType = "organization" | "project" | "api-key";

/**
 * Searchable picker for one of the tenant filters, backed by
 * `/admin/load/filter-options`. The list is server-side searched rather than
 * preloaded because these are cross-tenant catalogues — every organization,
 * project and API key on the platform.
 */
export function LoadEntitySelector({
	type,
	param,
	icon: Icon,
	allLabel,
	searchPlaceholder,
}: {
	type: LoadFilterType;
	param: string;
	icon: LucideIcon;
	allLabel: string;
	searchPlaceholder: string;
}) {
	const searchParams = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();
	const selectedId = searchParams.get(param) || null;
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [debouncedSearch, setDebouncedSearch] = useState("");
	const $api = useApi();

	useEffect(() => {
		const timer = setTimeout(() => setDebouncedSearch(search), 250);
		return () => clearTimeout(timer);
	}, [search]);

	const { data, isLoading } = $api.useQuery(
		"get",
		"/admin/load/filter-options",
		{ params: { query: { type, q: debouncedSearch || undefined } } },
		{ enabled: open },
	);

	// The selected id is rarely in the unfiltered first page, so its label is
	// looked up on its own rather than showing a raw id in the trigger.
	const { data: selectedData } = $api.useQuery(
		"get",
		"/admin/load/filter-options",
		{ params: { query: { type, id: selectedId ?? "" } } },
		{ enabled: Boolean(selectedId) },
	);
	const selectedLabel = selectedData?.options?.[0]?.label ?? selectedId;

	const setSelected = useCallback(
		(next: string | null) => {
			const params = new URLSearchParams(searchParams.toString());
			if (next) {
				params.set(param, next);
			} else {
				params.delete(param);
			}
			const query = params.toString();
			router.replace(query ? `${pathname}?${query}` : pathname, {
				scroll: false,
			});
			setOpen(false);
		},
		[searchParams, router, pathname, param],
	);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					size="sm"
					role="combobox"
					aria-expanded={open}
					aria-label={allLabel}
					className="h-8 max-w-[240px] justify-between gap-1.5 px-3 text-xs font-normal"
				>
					<Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
					<span className="truncate">{selectedLabel ?? allLabel}</span>
					<ChevronsUpDown
						className="h-3.5 w-3.5 shrink-0 opacity-50"
						aria-hidden
					/>
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-[360px] p-0" align="start">
				{/* Filtering happens server-side, so the built-in fuzzy filter would
				    hide rows the API already decided are matches. */}
				<Command shouldFilter={false}>
					<CommandInput
						placeholder={searchPlaceholder}
						value={search}
						onValueChange={setSearch}
					/>
					<CommandList>
						<CommandEmpty>
							{isLoading ? "Loading…" : "No matches."}
						</CommandEmpty>
						<CommandGroup>
							<CommandItem value="__all__" onSelect={() => setSelected(null)}>
								<Check
									className={cn(
										"mr-2 h-4 w-4",
										selectedId ? "opacity-0" : "opacity-100",
									)}
								/>
								{allLabel}
							</CommandItem>
							{(data?.options ?? []).map((option) => (
								<CommandItem
									key={option.id}
									value={option.id}
									onSelect={() => setSelected(option.id)}
								>
									<Check
										className={cn(
											"mr-2 h-4 w-4 shrink-0",
											selectedId === option.id ? "opacity-100" : "opacity-0",
										)}
									/>
									<span className="flex min-w-0 flex-1 flex-col">
										<span className="truncate">{option.label}</span>
										{option.sublabel ? (
											<span className="truncate text-xs text-muted-foreground">
												{option.sublabel}
											</span>
										) : null}
									</span>
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
