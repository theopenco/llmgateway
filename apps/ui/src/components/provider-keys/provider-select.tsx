"use client";

import { providerLogoUrls } from "@llmgateway/shared/components";
import { SearchableSelect } from "@llmgateway/shared/components";

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
	return (
		<SearchableSelect
			value={value}
			onValueChange={(next) => onValueChange?.(next)}
			disabled={disabled || loading}
			placeholder={loading ? "Loading providers..." : placeholder}
			searchPlaceholder="Search providers..."
			emptyMessage={emptyMessage}
			aria-label="Provider"
			options={providers.map((provider) => {
				const Logo = providerLogoUrls[provider.id as ProviderId];
				return {
					value: provider.id,
					label: provider.name,
					keywords: provider.id,
					icon: Logo ? <Logo className="h-4 w-4 shrink-0" /> : null,
				};
			})}
		/>
	);
}
