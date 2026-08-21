"use client";

import {
	Zap,
	Eye,
	Wrench,
	MessageSquare,
	Braces,
	FileJson2,
	ImagePlus,
	Gift,
	AlertCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { ModelCard } from "@/components/models/model-card";
import { Button } from "@/lib/components/button";

import { isMappingDeactivated } from "@llmgateway/shared/components";

import type {
	ApiModel,
	ApiModelProviderMapping,
	ApiProvider,
} from "@/lib/fetch-models";
import type { StabilityLevel } from "@llmgateway/models";
import type { LucideProps } from "lucide-react";

interface ModelWithProviders extends ApiModel {
	providerDetails: Array<{
		provider: ApiModelProviderMapping;
		providerInfo: ApiProvider;
	}>;
}

interface ProviderModelsGridProps {
	models: ModelWithProviders[];
}

export function ProviderModelsGrid({ models }: ProviderModelsGridProps) {
	const router = useRouter();
	const [showDeactivated, setShowDeactivated] = useState(false);

	// One card per provider mapping here, so a model is deactivated for this
	// provider exactly when its mapping is.
	const deactivatedCount = useMemo(
		() =>
			models.filter((model) =>
				model.providerDetails.every(({ provider }) =>
					isMappingDeactivated(provider),
				),
			).length,
		[models],
	);

	const visibleModels = useMemo(() => {
		if (showDeactivated) {
			return models;
		}
		return models.filter((model) =>
			model.providerDetails.some(
				({ provider }) => !isMappingDeactivated(provider),
			),
		);
	}, [models, showDeactivated]);

	const getCapabilityIcons = (
		providerMapping: ApiModelProviderMapping,
		model?: ApiModel,
	) => {
		const capabilities: Array<{
			icon: React.ForwardRefExoticComponent<
				Omit<LucideProps, "ref"> & React.RefAttributes<SVGSVGElement>
			>;
			label: string;
			color: string;
		}> = [];
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
		if (providerMapping.jsonOutputSchema) {
			capabilities.push({
				icon: FileJson2,
				label: "JSON Schema",
				color: "text-teal-500",
			});
		}
		const hasImageGen = Array.isArray(model?.output)
			? model.output.includes("image")
			: false;
		if (hasImageGen) {
			capabilities.push({
				icon: ImagePlus,
				label: "Image Generation",
				color: "text-pink-500",
			});
		}
		if (providerMapping.discount && parseFloat(providerMapping.discount) > 0) {
			capabilities.push({
				icon: Gift,
				label: `${(parseFloat(providerMapping.discount) * 100).toFixed(0)}% Discount`,
				color: "text-green-500",
			});
		}
		return capabilities;
	};

	const shouldShowStabilityWarning = (
		stability?: StabilityLevel | null,
	): boolean | undefined => {
		return (
			stability !== null &&
			stability !== undefined &&
			["unstable", "experimental"].includes(stability)
		);
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

	return (
		<>
			{deactivatedCount > 0 && (
				<div className="mb-6 flex justify-end">
					<Button
						variant="outline"
						size="sm"
						onClick={() => setShowDeactivated((prev) => !prev)}
					>
						<AlertCircle className="h-3.5 w-3.5 mr-1.5 text-red-500" />
						{showDeactivated
							? "Hide deactivated models"
							: `Show ${deactivatedCount} deactivated model${deactivatedCount === 1 ? "" : "s"}`}
					</Button>
				</div>
			)}
			<div className="grid gap-6 md:grid-cols-3">
				{visibleModels.map((model, index) => (
					<ModelCard
						key={`${model.providerDetails[0].provider.providerId}-${model.id}-${index}`}
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
		</>
	);
}
