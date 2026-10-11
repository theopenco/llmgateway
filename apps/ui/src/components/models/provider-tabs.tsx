"use client";

import Link from "next/link";

import { Button } from "@/lib/components/button";

import { providers as providerDefinitions } from "@llmgateway/models";
import { CarrierMark, getProviderIcon } from "@llmgateway/shared/components";

import type { ProviderTabBranding } from "./provider-tab-branding";

interface ProviderTabsProps {
	modelId: string;
	providerIds: string[];
	activeProviderId: string;
	branding?: Record<string, ProviderTabBranding>;
}

export function ProviderTabs({
	modelId,
	providerIds,
	activeProviderId,
	branding,
}: ProviderTabsProps) {
	// Providers with a marketing badge (e.g. SCX.ai "Up to 4x faster") first
	const uniqueProviderIds = Array.from(new Set(providerIds)).sort(
		(a, b) =>
			Number(
				Boolean(providerDefinitions.find((p) => p.id === b)?.modelCardBadge),
			) -
			Number(
				Boolean(providerDefinitions.find((p) => p.id === a)?.modelCardBadge),
			),
	);

	return (
		<div className="flex flex-wrap gap-2 mb-6">
			{uniqueProviderIds.map((providerId) => {
				const providerInfo = providerDefinitions.find(
					(p) => p.id === providerId,
				);
				const carrier = branding?.[providerId];
				const ProviderIcon = getProviderIcon(providerId);
				const isActive = providerId === activeProviderId;

				return (
					<Link
						key={providerId}
						href={
							`/models/${encodeURIComponent(modelId)}/${encodeURIComponent(providerId)}` as any
						}
					>
						<Button
							variant={isActive ? "secondary" : "outline"}
							size="sm"
							className="gap-2"
						>
							{carrier?.markUrl ? (
								<CarrierMark
									src={carrier.markUrl}
									className="h-4 w-4 object-contain"
								/>
							) : (
								ProviderIcon && <ProviderIcon className="h-4 w-4" />
							)}
							{providerInfo?.name ?? carrier?.name ?? providerId}
						</Button>
					</Link>
				);
			})}
		</div>
	);
}
