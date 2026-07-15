"use client";

import Footer from "@/components/landing/footer";
import { ModelCtaButton } from "@/components/models/model-cta-button";

import { AllModels as SharedAllModels } from "@llmgateway/shared/components";

import type { ComponentProps } from "react";

type SharedAllModelsProps = ComponentProps<typeof SharedAllModels>;

export function AllModels(
	props: Omit<SharedAllModelsProps, "footer" | "renderCta">,
) {
	return (
		<SharedAllModels
			{...props}
			footer={<Footer />}
			renderCta={(args) => <ModelCtaButton {...args} />}
		/>
	);
}
