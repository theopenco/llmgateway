"use client";

import { Check, ChevronDown, X } from "lucide-react";
import { useState, useCallback } from "react";

import { getProviderIcon } from "@llmgateway/shared/components";

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

import type { ProviderDefinition } from "@llmgateway/models";

interface ApiProvider {
	id: string;
	createdAt: string;
	name: string | null;
	description: string | null;
	streaming: boolean | null;
	cancellation: boolean | null;
	color: string | null;
	website: string | null;
	announcement: string | null;
	status: "active" | "inactive";
}

interface MultiProviderSelectorProps {
	providers: readonly ProviderDefinition[] | ApiProvider[];
	selectedProviders: string[];
	onProvidersChange: (providers: string[]) => void;
	placeholder?: string;
}

export function MultiProviderSelector({
	providers,
	selectedProviders,
	onProvidersChange,
	placeholder = "Select providers...",
}: MultiProviderSelectorProps) {
	const [open, setOpen] = useState(false);

	const handleProviderToggle = useCallback(
		(providerId: string) => {
			const isSelected = selectedProviders.includes(providerId);
			if (isSelected) {
				onProvidersChange(selectedProviders.filter((id) => id !== providerId));
			} else {
				onProvidersChange([...selectedProviders, providerId]);
			}
		},
		[selectedProviders, onProvidersChange],
	);

	const removeProvider = useCallback(
		(providerId: string) => {
			onProvidersChange(selectedProviders.filter((id) => id !== providerId));
		},
		[selectedProviders, onProvidersChange],
	);

	return (
		<div className="space-y-2">
			{selectedProviders.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{selectedProviders.map((providerId) => {
						const provider = providers.find((p) => p.id === providerId);
						const ProviderIcon = getProviderIcon(providerId);
						return (
							<Badge
								key={providerId}
								variant="secondary"
								className="flex items-center gap-1"
							>
								{ProviderIcon && <ProviderIcon className="h-3 w-3" />}
								{provider?.name ?? providerId}
								<Button
									variant="ghost"
									size="sm"
									className="h-3 w-3 p-0 hover:bg-transparent"
									onClick={() => removeProvider(providerId)}
								>
									<X className="h-2 w-2" />
								</Button>
							</Badge>
						);
					})}
				</div>
			)}

			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button
						variant="outline"
						role="combobox"
						aria-expanded={open}
						className="w-full justify-between"
					>
						<span className="text-left truncate">
							{selectedProviders.length === 0
								? placeholder
								: `${selectedProviders.length} provider${selectedProviders.length === 1 ? "" : "s"} selected`}
						</span>
						<ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
					</Button>
				</PopoverTrigger>
				<PopoverContent className="w-80 p-0 max-h-[400px]" align="start">
					<Command className="flex flex-col">
						<CommandInput placeholder="Search providers..." />
						<div className="max-h-[300px] overflow-y-auto">
							<CommandList>
								<CommandEmpty>No providers found.</CommandEmpty>
								{providers.map((provider) => {
									const isSelected = selectedProviders.includes(provider.id);
									const ProviderIcon = getProviderIcon(provider.id);

									return (
										<CommandItem
											key={provider.id}
											value={`${provider.id} ${provider.name}`}
											onSelect={() => handleProviderToggle(provider.id)}
											className="flex items-center justify-between py-3 cursor-pointer"
										>
											<div className="flex items-center gap-2">
												{ProviderIcon && <ProviderIcon className="h-4 w-4" />}
												<span className="font-medium">{provider.name}</span>
											</div>

											<div className="flex items-center gap-2">
												{provider.color && (
													<div
														className="w-3 h-3 rounded-full"
														style={{ backgroundColor: provider.color }}
													/>
												)}
												{isSelected && (
													<Check className="h-4 w-4 text-green-600" />
												)}
											</div>
										</CommandItem>
									);
								})}
							</CommandList>
						</div>
					</Command>
				</PopoverContent>
			</Popover>
		</div>
	);
}
