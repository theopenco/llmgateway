"use client";

import { AlertTriangle, Check, ChevronDown, X } from "lucide-react";
import { useState } from "react";

import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
	Command,
	CommandEmpty,
	CommandInput,
	CommandItem,
	CommandList,
} from "./ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

interface MultiModelIdSelectorProps {
	/** Canonical model ids offered for selection. */
	availableIds: readonly string[];
	value: string[];
	onChange: (ids: string[]) => void;
	placeholder?: string;
	searchPlaceholder?: string;
}

/**
 * Multi-select over plain canonical model ids, for callers that deal in root
 * model ids rather than full catalogue definitions (unlike MultiModelSelector,
 * which renders mapping-derived detail and needs the definitions).
 *
 * Pasting a comma/whitespace-separated list into the search box selects every
 * entry at once, accepting `provider/model` strings by stripping the prefix
 * when the bare id is selectable. Entries outside `availableIds` stay visible
 * as flagged chips, so a typo is seen here rather than only as a rejected
 * save.
 */
export function MultiModelIdSelector({
	availableIds,
	value,
	onChange,
	placeholder = "Select models...",
	searchPlaceholder = "Search models, or paste a comma-separated list...",
}: MultiModelIdSelectorProps) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");

	const toggleId = (modelId: string) => {
		onChange(
			value.includes(modelId)
				? value.filter((id) => id !== modelId)
				: [...value, modelId],
		);
	};

	const addPastedList = (text: string) => {
		const selectable = new Set(availableIds);
		const entries = text
			.split(/[\s,]+/)
			.map((entry) => entry.trim())
			.filter(Boolean)
			.map((entry) => {
				if (selectable.has(entry)) {
					return entry;
				}
				const slash = entry.indexOf("/");
				const suffix = slash >= 0 ? entry.slice(slash + 1) : entry;
				return selectable.has(suffix) ? suffix : entry;
			});
		onChange(Array.from(new Set([...value, ...entries])));
	};

	return (
		<div className="flex flex-col gap-2">
			{value.length > 0 ? (
				<div className="flex flex-wrap gap-1">
					{value.map((modelId) => {
						const unknown = !availableIds.includes(modelId);
						return (
							<Badge
								key={modelId}
								variant={unknown ? "destructive" : "secondary"}
								className="flex items-center gap-1 font-mono text-[11px]"
								title={
									unknown
										? "Not selectable here — check for a typo."
										: undefined
								}
							>
								{unknown ? <AlertTriangle className="h-3 w-3" /> : null}
								{modelId}
								<button
									type="button"
									aria-label={`Remove ${modelId}`}
									className="ml-0.5 rounded-sm opacity-70 hover:opacity-100"
									onClick={() => toggleId(modelId)}
								>
									<X className="h-3 w-3" />
								</button>
							</Badge>
						);
					})}
				</div>
			) : null}

			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button
						type="button"
						variant="outline"
						role="combobox"
						aria-expanded={open}
						className="w-full justify-between font-normal"
					>
						<span className="truncate text-left">
							{value.length === 0
								? placeholder
								: `${value.length} model${value.length === 1 ? "" : "s"} selected`}
						</span>
						<ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
					</Button>
				</PopoverTrigger>
				<PopoverContent className="w-[420px] p-0" align="start">
					<Command>
						<CommandInput
							placeholder={searchPlaceholder}
							value={search}
							onValueChange={setSearch}
							onPaste={(event) => {
								const text = event.clipboardData.getData("text");
								// A single id pastes into the search like any text; only a
								// list is intercepted and selected wholesale.
								if (!/[\s,]/.test(text.trim())) {
									return;
								}
								event.preventDefault();
								addPastedList(text);
								setSearch("");
							}}
						/>
						<CommandList className="max-h-[280px]">
							<CommandEmpty>No models found.</CommandEmpty>
							{availableIds.map((modelId) => {
								const isSelected = value.includes(modelId);
								return (
									<CommandItem
										key={modelId}
										value={modelId}
										onSelect={() => toggleId(modelId)}
										className="flex items-center justify-between"
									>
										<span className="font-mono text-xs">{modelId}</span>
										{isSelected ? (
											<Check className="h-4 w-4 text-green-600" />
										) : null}
									</CommandItem>
								);
							})}
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
		</div>
	);
}
