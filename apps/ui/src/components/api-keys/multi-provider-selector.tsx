"use client";

import { providers } from "@llmgateway/models";
import { Check, ChevronDown, X } from "lucide-react";
import { useState } from "react";

import { providerLogoUrls } from "@/components/provider-keys/provider-logo";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/lib/components/dropdown-menu";
import { Input } from "@/lib/components/input";

import type { ProviderId } from "@llmgateway/models";

interface MultiProviderSelectorProps {
	selectedProviders: string[];
	onProvidersChange: (providers: string[]) => void;
	placeholder?: string;
}

export function MultiProviderSelector({
	selectedProviders,
	onProvidersChange,
	placeholder = "Select providers...",
}: MultiProviderSelectorProps) {
	const [searchTerm, setSearchTerm] = useState("");

	const filteredProviders = providers.filter((provider) =>
		provider.name.toLowerCase().includes(searchTerm.toLowerCase()),
	);

	const handleProviderToggle = (providerId: string) => {
		const isSelected = selectedProviders.includes(providerId);
		if (isSelected) {
			onProvidersChange(selectedProviders.filter((id) => id !== providerId));
		} else {
			onProvidersChange([...selectedProviders, providerId]);
		}
	};

	const removeProvider = (providerId: string) => {
		onProvidersChange(selectedProviders.filter((id) => id !== providerId));
	};

	return (
		<div className="space-y-2">
			{selectedProviders.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{selectedProviders.map((providerId) => {
						const provider = providers.find((p) => p.id === providerId);
						const LogoComponent = providerLogoUrls[providerId as ProviderId];
						return (
							<Badge
								key={providerId}
								variant="secondary"
								className="flex items-center gap-1"
							>
								{LogoComponent && <LogoComponent className="h-3 w-3" />}
								{provider?.name || providerId}
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

			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="outline" className="gap-2 w-full justify-between">
						<span className="text-left truncate">
							{selectedProviders.length === 0
								? placeholder
								: `${selectedProviders.length} provider${selectedProviders.length === 1 ? "" : "s"} selected`}
						</span>
						<ChevronDown className="h-4 w-4 opacity-50" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent className="w-80 max-h-96 overflow-y-auto p-2">
					<div className="mb-2">
						<Input
							placeholder="Search providers..."
							value={searchTerm}
							onChange={(e) => setSearchTerm(e.target.value)}
							className="h-8"
						/>
					</div>
					{filteredProviders.map((provider) => {
						const LogoComponent = providerLogoUrls[provider.id as ProviderId];
						return (
							<DropdownMenuItem
								key={provider.id}
								onClick={() => handleProviderToggle(provider.id)}
								className="flex items-center justify-between py-3 cursor-pointer"
							>
								<div className="flex items-center gap-2">
									{LogoComponent && <LogoComponent className="h-4 w-4" />}
									<span className="font-medium">{provider.name}</span>
									{selectedProviders.includes(provider.id) && (
										<Check className="h-4 w-4 text-green-600" />
									)}
								</div>

								<div className="flex items-center gap-1">
									<div
										className="w-3 h-3 rounded-full"
										style={{ backgroundColor: provider.color }}
									/>
								</div>
							</DropdownMenuItem>
						);
					})}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
