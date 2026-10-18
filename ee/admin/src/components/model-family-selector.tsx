"use client";

import { Boxes, Check, ChevronsUpDown } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

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
import { cn } from "@/lib/utils";

import { modelFamilies } from "@llmgateway/models";
import { getModelFamilyIcon } from "@llmgateway/shared/components";

const PARAM = "family";

/**
 * Reads the selected model family from the `family` URL param. Unknown slugs
 * read as "no filter" so a stale link cannot blank the page.
 */
export function useModelFamilyFilter(): string | null {
	const searchParams = useSearchParams();
	const value = searchParams.get(PARAM);
	return value && modelFamilies.some((entry) => entry.id === value)
		? value
		: null;
}

function FamilyIcon({ family }: { family: string }) {
	const Icon = getModelFamilyIcon(family);
	return <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />;
}

/**
 * Narrows a global usage view to one model family (Claude, Gemini, GPT, …)
 * regardless of which provider served it, persisted in the `family` param.
 */
export function ModelFamilySelector({ className }: { className?: string }) {
	const searchParams = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();
	const family = useModelFamilyFilter();
	const [open, setOpen] = useState(false);

	const setFamily = useCallback(
		(next: string | null) => {
			const params = new URLSearchParams(searchParams.toString());
			if (next) {
				params.set(PARAM, next);
			} else {
				params.delete(PARAM);
			}
			const query = params.toString();
			router.replace(query ? `${pathname}?${query}` : pathname, {
				scroll: false,
			});
			setOpen(false);
		},
		[searchParams, router, pathname],
	);

	const selected = modelFamilies.find((entry) => entry.id === family);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					size="sm"
					role="combobox"
					aria-expanded={open}
					aria-label="Model family"
					className={cn(
						"h-8 max-w-[240px] justify-between gap-1.5 px-3 text-xs font-normal",
						className,
					)}
				>
					{family ? (
						<FamilyIcon family={family} />
					) : (
						<Boxes className="h-3.5 w-3.5 shrink-0" aria-hidden />
					)}
					<span className="truncate">{selected?.label ?? "All families"}</span>
					<ChevronsUpDown
						className="h-3.5 w-3.5 shrink-0 opacity-50"
						aria-hidden
					/>
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-[280px] p-0" align="start">
				<Command>
					<CommandInput placeholder="Search families…" />
					<CommandList>
						<CommandEmpty>No such family.</CommandEmpty>
						<CommandGroup>
							<CommandItem value="__all__" onSelect={() => setFamily(null)}>
								<Check
									className={cn(
										"mr-2 h-4 w-4",
										family ? "opacity-0" : "opacity-100",
									)}
								/>
								All families
							</CommandItem>
							{modelFamilies.map((entry) => (
								<CommandItem
									key={entry.id}
									value={`${entry.label} ${entry.id}`}
									onSelect={() => setFamily(entry.id)}
								>
									<Check
										className={cn(
											"mr-2 h-4 w-4 shrink-0",
											family === entry.id ? "opacity-100" : "opacity-0",
										)}
									/>
									<FamilyIcon family={entry.id} />
									<span className="ml-2 min-w-0 flex-1 truncate">
										{entry.label}
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
