"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";

import { AllModels as SharedAllModels } from "@llmgateway/shared/components";

import type { ComponentProps } from "react";

type SharedAllModelsProps = ComponentProps<typeof SharedAllModels>;

export function DevPassModelsDirectory({
	uiUrl,
	...rest
}: Omit<
	SharedAllModelsProps,
	| "footer"
	| "renderCta"
	| "modelHrefBase"
	| "defaultCategory"
	| "hideUseCaseFilter"
> & {
	uiUrl: string;
}) {
	return (
		<SharedAllModels
			{...rest}
			modelHrefBase={uiUrl}
			showPricingTierFilter
			defaultCategory="code"
			hideUseCaseFilter
			footer={<Footer />}
			renderCta={({ size, className, iconClassName, onClick }) => (
				<Button
					variant="default"
					size={size}
					className={className}
					onClick={onClick}
					asChild
				>
					<Link href="/signup">
						Get DevPass
						<ArrowRight className={iconClassName} />
					</Link>
				</Button>
			)}
		/>
	);
}
