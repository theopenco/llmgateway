"use client";

import {
	Zap,
	Eye,
	Wrench,
	MessageSquare,
	ImagePlus,
	Braces,
	FileJson2,
	Gift,
} from "lucide-react";

import { ModelCard } from "./model-card";

import type {
	ModelDefinition,
	ProviderModelMapping,
	StabilityLevel,
	providers,
} from "@llmgateway/models";
import type { LucideProps } from "lucide-react";

interface ModelWithProviders extends ModelDefinition {
	providerDetails: Array<{
		provider: ProviderModelMapping;
		providerInfo: (typeof providers)[number];
	}>;
}

interface ModelDetailCardProps {
	model: ModelWithProviders;
}

export function ModelDetailCard({ model }: ModelDetailCardProps) {
	const shouldShowStabilityWarning = (stability?: StabilityLevel) => {
		return stability && ["unstable", "experimental"].includes(stability);
	};

	const formatPrice = (price: number | undefined, discount?: number) => {
		if (price === undefined) {
			return "—";
		}
		const originalPrice = price * 1e6;
		if (discount) {
			const discountedPrice = price * 1e6 * (1 - discount);
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

	const getCapabilityIcons = (
		provider: ProviderModelMapping,
		modelData?: any,
	) => {
		const capabilities: Array<{
			icon: React.ForwardRefExoticComponent<
				Omit<LucideProps, "ref"> & React.RefAttributes<SVGSVGElement>
			>;
			label: string;
			color: string;
		}> = [];

		if (provider.streaming) {
			capabilities.push({
				icon: Zap,
				label: "Streaming",
				color: "text-blue-500",
			});
		}
		if (provider.vision) {
			capabilities.push({
				icon: Eye,
				label: "Vision",
				color: "text-green-500",
			});
		}
		if (provider.tools) {
			capabilities.push({
				icon: Wrench,
				label: "Tools",
				color: "text-purple-500",
			});
		}
		if (provider.reasoning) {
			capabilities.push({
				icon: MessageSquare,
				label: "Reasoning",
				color: "text-orange-500",
			});
		}
		if (provider.jsonOutput) {
			capabilities.push({
				icon: Braces,
				label: "JSON Output",
				color: "text-cyan-500",
			});
		}
		if (provider.jsonOutputSchema) {
			capabilities.push({
				icon: FileJson2,
				label: "JSON Schema",
				color: "text-teal-500",
			});
		}
		const hasImageGen = Array.isArray(modelData?.output)
			? modelData.output.includes("image")
			: false;
		if (hasImageGen) {
			capabilities.push({
				icon: ImagePlus,
				label: "Image Generation",
				color: "text-pink-500",
			});
		}
		if (provider.discount && provider.discount > 0) {
			capabilities.push({
				icon: Gift,
				label: `${(provider.discount * 100).toFixed(0)}% Discount`,
				color: "text-green-500",
			});
		}
		return capabilities;
	};

	return (
		<ModelCard
			model={model}
			shouldShowStabilityWarning={shouldShowStabilityWarning}
			getCapabilityIcons={getCapabilityIcons}
			goToModel={() => {}}
			formatPrice={formatPrice}
		/>
	);
}
