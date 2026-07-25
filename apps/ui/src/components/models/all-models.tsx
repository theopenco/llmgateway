"use client";

import { useSearchParams } from "next/navigation";

import Footer from "@/components/landing/footer";
import { ModelCtaButton } from "@/components/models/model-cta-button";

import { AllModels as SharedAllModels } from "@llmgateway/shared/components";

import type { ComponentProps } from "react";

type SharedAllModelsProps = ComponentProps<typeof SharedAllModels>;

export function AllModels(
	props: Omit<
		SharedAllModelsProps,
		"footer" | "renderCta" | "showPricingTierFilter"
	>,
) {
	const searchParams = useSearchParams();
	// The premium/standard tier only matters for DevPass fair-use limits, so
	// the filter stays hidden unless the visitor arrives from DevPass
	// (?from=devpass) or a tier deep link (?tier=...) is already active.
	const showPricingTierFilter =
		searchParams.get("from") === "devpass" || searchParams.has("tier");

	return (
		<SharedAllModels
			{...props}
			footer={<Footer />}
			renderCta={(args) => <ModelCtaButton {...args} />}
			showPricingTierFilter={showPricingTierFilter}
		/>
	);
}
