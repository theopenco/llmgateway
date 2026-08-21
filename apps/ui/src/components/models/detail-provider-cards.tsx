"use client";

import { AlertCircle } from "lucide-react";
import { useMemo, useState } from "react";

import { ModelCtaButton } from "@/components/models/model-cta-button";
import { Button } from "@/lib/components/button";
import { TooltipProvider } from "@/lib/components/tooltip";

import {
	getProviderIcon,
	isMappingDeactivated,
} from "@llmgateway/shared/components";

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
	const [showDeactivated, setShowDeactivated] = useState(false);
	const isImageGen = Array.isArray(model.output)
		? model.output.includes("image")
		: false;

	const copyToClipboard = (text: string) => {
		void navigator.clipboard.writeText(text);
		setCopiedModel(text);
		setTimeout(() => setCopiedModel(null), 2000);
	};

	const formatPrice = (
		price: string | null | undefined,
		discount?: string | null,
		align: "center" | "end" = "center",
		multiplier = 1,
	) => {
		if (price === null || price === undefined) {
			return "—";
		}
		const priceNum = parseFloat(price) * multiplier;
		const discountNum = discount ? parseFloat(discount) : 0;
		const originalPrice = parseFloat((priceNum * 1e6).toFixed(4));
		if (discountNum > 0) {
			const discountedPrice = parseFloat(
				(priceNum * 1e6 * (1 - discountNum)).toFixed(4),
			);
			return (
				<div
					className={`flex items-center gap-1 ${align === "end" ? "justify-end" : "justify-center"}`}
				>
					<span className="line-through text-muted-foreground text-xs">
						${originalPrice}
					</span>
					<span className="text-green-600 font-semibold">
						${discountedPrice}
					</span>
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

	const deactivatedCount = useMemo(
		() =>
			model.providerDetails.filter(({ provider }) =>
				isMappingDeactivated(provider),
			).length,
		[model.providerDetails],
	);

	// Deactivated providers cannot serve requests, so they are hidden unless the
	// visitor asks for them. A model whose providers are all deactivated still
	// shows them, otherwise the page would render an empty grid.
	const visibleProviderDetails = useMemo(() => {
		if (showDeactivated || deactivatedCount === model.providerDetails.length) {
			return model.providerDetails;
		}
		return model.providerDetails.filter(
			({ provider }) => !isMappingDeactivated(provider),
		);
	}, [model.providerDetails, showDeactivated, deactivatedCount]);

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
		for (const { provider, providerInfo } of visibleProviderDetails) {
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
		// Providers with a marketing badge (e.g. SCX.ai "Up to 4x faster") first
		return Array.from(map.values()).sort(
			(a, b) =>
				Number(Boolean(b.providerInfo?.modelCardBadge)) -
				Number(Boolean(a.providerInfo?.modelCardBadge)),
		);
	}, [visibleProviderDetails]);

	const canToggleDeactivated =
		deactivatedCount > 0 && deactivatedCount < model.providerDetails.length;

	return (
		<TooltipProvider>
			{canToggleDeactivated && (
				<div className="mb-4 flex justify-end">
					<Button
						variant="outline"
						size="sm"
						onClick={() => setShowDeactivated((prev) => !prev)}
					>
						<AlertCircle className="h-3.5 w-3.5 mr-1.5 text-red-500" />
						{showDeactivated
							? "Hide deactivated providers"
							: `Show ${deactivatedCount} deactivated provider${deactivatedCount === 1 ? "" : "s"}`}
					</Button>
				</div>
			)}
			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
				{groupedByProvider.map(({ providerInfo, providerId, mappings }) => {
					const ProviderIcon = getProviderIcon(providerId);
					const hasRegions =
						mappings.length > 1 ||
						(mappings.length === 1 && !!mappings[0].region);

					return (
						<div key={providerId} className="flex h-full flex-col gap-3">
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
								isImageGen={isImageGen}
								detailed
							/>
							<ModelCtaButton
								modelId={`${providerId}/${model.id}`}
								output={model.output}
							/>
						</div>
					);
				})}
			</div>
		</TooltipProvider>
	);
}
