"use client";

import { useSearchParams } from "next/navigation";

import { ModelCtaButton } from "@/components/models/model-cta-button";

import { AllModels as SharedAllModels } from "@llmgateway/shared/components";

import type { ComponentProps } from "react";

type SharedAllModelsProps = ComponentProps<typeof SharedAllModels>;

// `footer` is passed in from the server pages (usually <Footer />) so the
// server-only footer never enters this client bundle.
export function AllModels(
	props: Omit<SharedAllModelsProps, "renderCta" | "showPricingTierFilter">,
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
			renderCta={(args) => <ModelCtaButton {...args} />}
			showPricingTierFilter={showPricingTierFilter}
		/>
	);
}
