"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { Button } from "./ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "./ui/command";
import {
	DialogSafePopover,
	PopoverContent,
	PopoverTrigger,
} from "./ui/popover";

import type { ReactNode } from "react";

export interface SearchableSelectOption {
	value: string;
	label: string;
	/** Rendered before the label, e.g. a provider logo. */
	icon?: ReactNode;
	/** Rendered right-aligned before the check mark, e.g. a count badge. */
	annotation?: ReactNode;
	/**
	 * Extra text the search should match in addition to the label. Use it for
	 * ids and aliases so "vertex" finds a provider whoever named it differently.
	 */
	keywords?: string;
}

export interface SearchableSelectProps {
	value?: string;
	onValueChange: (value: string) => void;
	options: SearchableSelectOption[];
	placeholder?: string;
	searchPlaceholder?: string;
	emptyMessage?: string;
	disabled?: boolean;
	id?: string;
	className?: string;
	"aria-label"?: string;
}

/**
 * Single-select combobox with a search field, for lists too long to scan in a
 * plain `Select`.
 *
 * Use this rather than hand-rolling Popover + Command. Besides the duplication,
 * the hand-rolled version has a trap: a Radix `Popover` renders through a
 * portal attached to `<body>`, so inside a modal `Dialog` it lands *outside*
 * the dialog's scroll lock. `react-remove-scroll` then calls `preventDefault`
 * on every wheel event over the list and the options cannot be scrolled at all
 * — only keyboard navigation and search work, which is easy to miss in review.
 * `DialogSafePopover` gives it its own scroll lock that whitelists its content,
 * and that is baked in here so every caller gets it.
 */
export function SearchableSelect({
	value,
	onValueChange,
	options,
	placeholder = "Select...",
	searchPlaceholder = "Search...",
	emptyMessage = "No results found.",
	disabled = false,
	id,
	className,
	"aria-label": ariaLabel,
}: SearchableSelectProps) {
	const [open, setOpen] = useState(false);

	const selected = options.find((option) => option.value === value);

	return (
		<DialogSafePopover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					id={id}
					type="button"
					variant="outline"
					role="combobox"
					aria-expanded={open}
					aria-label={ariaLabel}
					disabled={disabled}
					className={cn("w-full justify-between font-normal", className)}
				>
					{selected ? (
						<span className="flex min-w-0 items-center gap-2">
							{selected.icon}
							<span className="truncate">{selected.label}</span>
						</span>
					) : (
						<span className="text-muted-foreground">{placeholder}</span>
					)}
					<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				className="w-[--radix-popover-trigger-width] p-0"
				align="start"
			>
				<Command>
					<CommandInput placeholder={searchPlaceholder} />
					<CommandList>
						<CommandEmpty>{emptyMessage}</CommandEmpty>
						<CommandGroup>
							{options.map((option) => (
								<CommandItem
									key={option.value}
									value={
										option.keywords
											? `${option.label} ${option.keywords}`
											: option.label
									}
									onSelect={() => {
										onValueChange(option.value);
										setOpen(false);
									}}
								>
									{option.icon}
									<span className="truncate">{option.label}</span>
									<span className="ml-auto flex shrink-0 items-center gap-2">
										{option.annotation}
										<Check
											className={cn(
												"h-4 w-4",
												value === option.value ? "opacity-100" : "opacity-0",
											)}
										/>
									</span>
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</DialogSafePopover>
	);
}
