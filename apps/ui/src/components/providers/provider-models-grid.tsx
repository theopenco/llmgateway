"use client";

import {
	Zap,
	Eye,
	Wrench,
	MessageSquare,
	Braces,
	ImagePlus,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { ModelCard } from "@/components/models/model-card";

import type {
	ModelDefinition,
	ProviderModelMapping,
	StabilityLevel,
	providers,
} from "@llmgateway/models";

interface ModelWithProviders extends ModelDefinition {
	providerDetails: Array<{
		provider: ProviderModelMapping;
		providerInfo: (typeof providers)[number];
	}>;
}

interface ProviderModelsGridProps {
	models: ModelWithProviders[];
}

export function ProviderModelsGrid({ models }: ProviderModelsGridProps) {
	const router = useRouter();

	const getCapabilityIcons = (
		providerMapping: ProviderModelMapping,
		model?: any,
	) => {
		const capabilities = [];
		if (providerMapping.streaming) {
			capabilities.push({
				icon: Zap,
				label: "Streaming",
				color: "text-blue-500",
			});
		}
		if (providerMapping.vision) {
			capabilities.push({
				icon: Eye,
				label: "Vision",
				color: "text-green-500",
			});
		}
		if (providerMapping.tools) {
			capabilities.push({
				icon: Wrench,
				label: "Tools",
				color: "text-purple-500",
			});
		}
		if (providerMapping.reasoning) {
			capabilities.push({
				icon: MessageSquare,
				label: "Reasoning",
				color: "text-orange-500",
			});
		}
		if (providerMapping.jsonOutput) {
			capabilities.push({
				icon: Braces,
				label: "JSON Output",
				color: "text-cyan-500",
			});
		}
		if (model?.output?.includes("image")) {
			capabilities.push({
				icon: ImagePlus,
				label: "Image Generation",
				color: "text-pink-500",
			});
		}
		return capabilities;
	};

	const shouldShowStabilityWarning = (stability?: StabilityLevel) => {
		return stability && ["unstable", "experimental"].includes(stability);
	};

	const formatPrice = (price: number | undefined, discount?: number) => {
		if (price === undefined) {
			return "—";
		}
		const originalPrice = (price * 1e6).toFixed(2);
		if (discount) {
			const discountedPrice = (price * 1e6 * (1 - discount)).toFixed(2);
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

	return (
		<div className="grid gap-6 md:grid-cols-3">
			{models.map((model) => (
				<ModelCard
					key={`${model.providerDetails[0].provider.providerId}-${model.id}`}
					model={model}
					shouldShowStabilityWarning={shouldShowStabilityWarning}
					getCapabilityIcons={getCapabilityIcons}
					goToModel={() =>
						router.push(`/models/${encodeURIComponent(model.id)}`)
					}
					formatPrice={formatPrice}
				/>
			))}
		</div>
	);
}
