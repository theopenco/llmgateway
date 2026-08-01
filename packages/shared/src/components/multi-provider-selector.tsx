"use client";

import { Check, ChevronDown, ShieldAlert, ShieldCheck, X } from "lucide-react";
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
import { Switch } from "./ui/switch";

/**
 * Minimal structural shape a selectable provider entry must have. Catalogue
 * `ProviderDefinition`s, DB-backed API provider rows, and synthetic entries
 * (e.g. an org's custom providers as `custom:<name>` refs) all satisfy it.
 */
export interface SelectableProviderOption {
	id: string;
	name: string | null;
	color?: string | null;
	/**
	 * Whether the provider currently meets the caller's policy requirements.
	 * When set (on any option), the dropdown becomes policy-aware: options show
	 * a green/red shield instead of the brand color dot, failing options list
	 * their `policyNotes`, and a "compatible only" filter toggle is offered.
	 */
	meetsPolicy?: boolean;
	/** Human-readable requirements behind `meetsPolicy === false`. */
	policyNotes?: string[];
}

interface MultiProviderSelectorProps {
	providers: readonly SelectableProviderOption[];
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
	const [compatibleOnly, setCompatibleOnly] = useState(false);

	const isPolicyAware = providers.some(
		(provider) => provider.meetsPolicy !== undefined,
	);
	// Selected options stay visible under the filter so they can be unselected.
	const visibleProviders =
		isPolicyAware && compatibleOnly
			? providers.filter(
					(provider) =>
						provider.meetsPolicy !== false ||
						selectedProviders.includes(provider.id),
				)
			: providers;

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
								{provider?.meetsPolicy === false && (
									<span
										title={
											provider.policyNotes?.length
												? provider.policyNotes.join("; ")
												: "Does not meet policy requirements"
										}
									>
										<ShieldAlert
											className="h-3 w-3 text-red-500"
											aria-label="Does not meet policy requirements"
										/>
									</span>
								)}
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
						{isPolicyAware && (
							<div className="flex items-center justify-between gap-2 border-b px-3 py-2">
								<span className="text-xs text-muted-foreground">
									Only providers that meet policy requirements
								</span>
								<Switch
									checked={compatibleOnly}
									onCheckedChange={setCompatibleOnly}
									aria-label="Only show providers that meet policy requirements"
								/>
							</div>
						)}
						<div className="max-h-[300px] overflow-y-auto">
							<CommandList>
								<CommandEmpty>
									{isPolicyAware && compatibleOnly
										? "No providers meet the policy requirements."
										: "No providers found."}
								</CommandEmpty>
								{visibleProviders.map((provider) => {
									const isSelected = selectedProviders.includes(provider.id);
									const ProviderIcon = getProviderIcon(provider.id);

									return (
										<CommandItem
											key={provider.id}
											value={`${provider.id} ${provider.name}`}
											onSelect={() => handleProviderToggle(provider.id)}
											className="flex items-center justify-between py-3 cursor-pointer"
										>
											<div className="flex min-w-0 items-center gap-2">
												{ProviderIcon && (
													<ProviderIcon className="h-4 w-4 shrink-0" />
												)}
												<div className="min-w-0">
													<span className="font-medium">{provider.name}</span>
													{provider.meetsPolicy === false &&
														provider.policyNotes &&
														provider.policyNotes.length > 0 && (
															<p
																className="truncate text-xs text-red-600 dark:text-red-400"
																title={provider.policyNotes.join("; ")}
															>
																{provider.policyNotes.join(" · ")}
															</p>
														)}
												</div>
											</div>

											<div className="flex shrink-0 items-center gap-2">
												{provider.meetsPolicy !== undefined ? (
													provider.meetsPolicy ? (
														<ShieldCheck
															className="h-4 w-4 text-emerald-600"
															aria-label="Meets policy requirements"
														/>
													) : (
														<ShieldAlert
															className="h-4 w-4 text-red-500"
															aria-label="Does not meet policy requirements"
														/>
													)
												) : (
													provider.color && (
														<div
															className="w-3 h-3 rounded-full"
															style={{ backgroundColor: provider.color }}
														/>
													)
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
						{isPolicyAware && (
							<div className="flex items-center gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
								<span className="flex items-center gap-1">
									<ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
									Meets policy requirements
								</span>
								<span className="flex items-center gap-1">
									<ShieldAlert className="h-3.5 w-3.5 text-red-500" />
									Does not meet
								</span>
							</div>
						)}
					</Command>
				</PopoverContent>
			</Popover>
		</div>
	);
}
