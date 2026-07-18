import { Gem, Zap } from "lucide-react";
import { Suspense } from "react";

import { DevPassModelsDirectory } from "@/components/DevPassModelsDirectory";
import { Header } from "@/components/Header";
import { getConfig } from "@/lib/config-server";

import {
	DEV_PLAN_PREMIUM_WEEKLY_PERCENT,
	HIGH_COST_INPUT_PRICE,
	HIGH_COST_OUTPUT_PRICE,
} from "@llmgateway/shared";
import {
	fetchModelsFromApi,
	fetchProvidersFromApi,
} from "@llmgateway/shared/components";

import type { Metadata } from "next";

const PREMIUM_INPUT_PER_M = HIGH_COST_INPUT_PRICE * 1e6;
const PREMIUM_OUTPUT_PER_M = HIGH_COST_OUTPUT_PRICE * 1e6;

export const metadata: Metadata = {
	title: "Coding Models on DevPass — Full Directory",
	description:
		"Browse the coding models available on DevPass — search, filter by pricing tier, capabilities, provider, price, and context size. Premium models are marked exactly as the gateway classifies them.",
	alternates: { canonical: "/models" },
	openGraph: {
		title: "Coding Models on DevPass — Full Directory",
		description:
			"Browse the coding models available on DevPass — search, filter by pricing tier, capabilities, provider, price, and context size.",
		type: "website",
		url: "https://devpass.llmgateway.io/models",
	},
};

export default async function DevPassModelsPage() {
	const config = getConfig();
	const [models, providers] = await Promise.all([
		fetchModelsFromApi(config.apiBackendUrl),
		fetchProvidersFromApi(config.apiBackendUrl),
	]);

	const collectionSchema = {
		"@context": "https://schema.org",
		"@type": "CollectionPage",
		name: "Coding Models on DevPass",
		description:
			"The coding models available on DevPass, with the exact premium/standard fair-use classification the gateway enforces.",
		url: "https://devpass.llmgateway.io/models",
	};
	const collectionSchemaJson = JSON.stringify(collectionSchema).replace(
		/</g,
		"\\u003c",
	);

	return (
		<>
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{ __html: collectionSchemaJson }}
			/>
			<Suspense>
				<DevPassModelsDirectory
					uiUrl={config.uiUrl}
					models={models}
					providers={providers}
					title="Coding models on DevPass"
					description="The coding models on your DevPass plan — filter by pricing tier to see exactly which models count against the weekly premium allowance and which don't."
					seoContent={
						<section className="container mx-auto px-4 pb-16">
							<h2 className="text-2xl font-bold mb-4">
								Premium vs. standard models
							</h2>
							<div className="max-w-3xl space-y-3 text-muted-foreground">
								<p>
									<Gem className="mr-1 inline h-4 w-4 text-amber-500" />
									<strong className="text-foreground">Premium</strong> is a
									pricing classification, not a marketing tag: a model is
									premium when any provider charges ${PREMIUM_INPUT_PER_M}+ per
									million input tokens or ${PREMIUM_OUTPUT_PER_M}+ per million
									output tokens. Premium usage is covered by a weekly fair-use
									allowance on top of your plan credits:{" "}
									{Math.round(DEV_PLAN_PREMIUM_WEEKLY_PERCENT.lite * 100)}% of
									monthly credits on Lite,{" "}
									{Math.round(DEV_PLAN_PREMIUM_WEEKLY_PERCENT.pro * 100)}% on
									Pro, and{" "}
									{Math.round(DEV_PLAN_PREMIUM_WEEKLY_PERCENT.max * 100)}% on
									Max. The allowance works on a fixed 7-day window that opens
									with your first premium request and fully resets when it ends.
								</p>
								<p>
									<Zap className="mr-1 inline h-4 w-4 text-emerald-500" />
									<strong className="text-foreground">Standard</strong> models
									have no weekly cap — use them as much as your plan credits
									allow. Use the Pricing Tier filter above to see exactly which
									models fall on each side; premium models are also marked with
									a gem icon.
								</p>
							</div>
						</section>
					}
				>
					<Header />
				</DevPassModelsDirectory>
			</Suspense>
		</>
	);
}
