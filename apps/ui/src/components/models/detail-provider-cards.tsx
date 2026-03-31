"use client";

import { useMemo, useState } from "react";

import { ModelCtaButton } from "@/components/models/model-cta-button";
import { TooltipProvider } from "@/lib/components/tooltip";

import { getProviderIcon } from "@llmgateway/shared/components";

import { ProviderSection } from "./model-card";

import type {
	ApiModel,
	ApiModelProviderMapping,
	ApiProvider,
} from "@/lib/fetch-models";

interface ModelWithProviders extends ApiModel {
	providerDetails: Array<{
		provider: ApiModelProviderMapping;
		providerInfo: ApiProvider;
	}>;
}

export function DetailProviderCards({ model }: { model: ModelWithProviders }) {
	const [copiedModel, setCopiedModel] = useState<string | null>(null);

	const copyToClipboard = (text: string) => {
		void navigator.clipboard.writeText(text);
		setCopiedModel(text);
		setTimeout(() => setCopiedModel(null), 2000);
	};

	const formatPrice = (
		price: string | null | undefined,
		discount?: string | null,
	) => {
		if (price === null || price === undefined) {
			return "—";
		}
		const priceNum = parseFloat(price);
		const discountNum = discount ? parseFloat(discount) : 0;
		const originalPrice = parseFloat((priceNum * 1e6).toFixed(4));
		if (discountNum > 0) {
			const discountedPrice = parseFloat(
				(priceNum * 1e6 * (1 - discountNum)).toFixed(4),
			);
			return (
				<div className="flex flex-col justify-items-center">
					<div className="flex items-center gap-1">
						<span className="line-through text-muted-foreground text-xs">
							${originalPrice}
						</span>
						<span className="text-green-600 font-semibold">
							${discountedPrice}
						</span>
					</div>
				</div>
			);
		}
		return `$${originalPrice}`;
	};

	const hasProviderStabilityWarning = (
		provider: ApiModelProviderMapping,
	): boolean => {
		return (
			provider.stability !== null &&
			provider.stability !== undefined &&
			["unstable", "experimental"].includes(provider.stability)
		);
	};

	// Group by provider ID so regions show as tabs within one card
	const groupedByProvider = useMemo(() => {
		const map = new Map<
			string,
			{
				providerInfo: ApiProvider;
				providerId: string;
				mappings: ApiModelProviderMapping[];
			}
		>();
		for (const { provider, providerInfo } of model.providerDetails) {
			const key = provider.providerId;
			if (!map.has(key)) {
				map.set(key, {
					providerInfo,
					providerId: key,
					mappings: [],
				});
			}
			map.get(key)!.mappings.push(provider);
		}
		return Array.from(map.values());
	}, [model.providerDetails]);

	return (
		<TooltipProvider>
			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
				{groupedByProvider.map(({ providerInfo, providerId, mappings }) => {
					const ProviderIcon = getProviderIcon(providerId);
					const hasRegions =
						mappings.length > 1 ||
						(mappings.length === 1 && !!mappings[0].region);

					return (
						<div key={providerId} className="flex flex-col gap-3">
							<ProviderSection
								modelId={model.id}
								providerInfo={providerInfo}
								providerId={providerId}
								ProviderIcon={ProviderIcon}
								mappings={mappings}
								hasRegions={hasRegions}
								hasProviderStabilityWarning={hasProviderStabilityWarning}
								formatPrice={formatPrice}
								copyToClipboard={copyToClipboard}
								copiedModel={copiedModel}
							/>
							<ModelCtaButton modelId={`${providerId}/${model.id}`} />
						</div>
					);
				})}
			</div>
		</TooltipProvider>
	);
}
