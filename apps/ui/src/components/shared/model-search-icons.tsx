"use client";

import {
	getModelFamilyIcon,
	getProviderIcon,
} from "@llmgateway/shared/components";

// Loaded via next/dynamic from ModelSearch: the provider/family icon maps are
// ~150KB of inline SVG that only matter once the search popover is open, so
// they must stay out of the navbar's (every marketing page's) initial bundle.

export function ProviderSearchIcon({
	providerId,
	name,
}: {
	providerId: string;
	name: string;
}) {
	const ProviderIcon = getProviderIcon(providerId);
	return ProviderIcon ? (
		<ProviderIcon className="h-5 w-5" />
	) : (
		<span className="text-xs font-medium uppercase text-muted-foreground">
			{name.charAt(0)}
		</span>
	);
}

export function FamilySearchIcon({ family }: { family: string }) {
	const FamilyIcon = getModelFamilyIcon(family);
	return <FamilyIcon className="h-5 w-5" />;
}
