"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";

import { Button } from "@/lib/components/button";
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
import { cn } from "@/lib/utils";

import { providerLogoUrls } from "@llmgateway/shared/components";

import type { ProviderId } from "@llmgateway/models";

interface Provider {
	id: string;
	name: string;
}

interface ProviderSelectProps {
	value?: string;
	onValueChange?: (value: string) => void;
	providers: Provider[];
	loading?: boolean;
	placeholder?: string;
	emptyMessage?: string;
	disabled?: boolean;
}

export function ProviderSelect({
	value,
	onValueChange,
	providers,
	loading = false,
	placeholder = "Select provider...",
	emptyMessage = "No providers found.",
	disabled = false,
}: ProviderSelectProps) {
	const [open, setOpen] = useState(false);

	const selected = providers.find((provider) => provider.id === value);
	const SelectedLogo = selected
		? providerLogoUrls[selected.id as ProviderId]
		: undefined;

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="outline"
					role="combobox"
					aria-expanded={open}
					disabled={disabled || loading}
					className="w-full justify-between font-normal"
				>
					{selected ? (
						<span className="flex min-w-0 items-center gap-2">
							{SelectedLogo && <SelectedLogo className="h-4 w-4 shrink-0" />}
							<span className="truncate">{selected.name}</span>
						</span>
					) : (
						<span className="text-muted-foreground">
							{loading ? "Loading providers..." : placeholder}
						</span>
					)}
					<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				className="w-[--radix-popover-trigger-width] p-0"
				align="start"
			>
				<Command>
					<CommandInput placeholder="Search providers..." />
					<CommandList>
						<CommandEmpty>{emptyMessage}</CommandEmpty>
						<CommandGroup>
							{providers.map((provider) => {
								const LogoComponent =
									providerLogoUrls[provider.id as ProviderId];
								return (
									<CommandItem
										key={provider.id}
										value={`${provider.name} ${provider.id}`}
										onSelect={() => {
											onValueChange?.(provider.id);
											setOpen(false);
										}}
									>
										{LogoComponent && (
											<LogoComponent className="h-4 w-4 shrink-0" />
										)}
										<span className="truncate">{provider.name}</span>
										<Check
											className={cn(
												"ml-auto h-4 w-4 shrink-0",
												value === provider.id ? "opacity-100" : "opacity-0",
											)}
										/>
									</CommandItem>
								);
							})}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
