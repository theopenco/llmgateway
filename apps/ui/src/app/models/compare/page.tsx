import { Suspense } from "react";

import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { ModelComparison } from "@/components/models/model-comparison";

export const metadata = {
	title: "Compare AI Models Side by Side",
	description:
		"Select any two AI models to compare pricing, context window, and capabilities with our interactive model comparison tool.",
	openGraph: {
		title: "AI Model Comparison Tool",
		description:
			"Compare LLM pricing, context, and features across providers in a side-by-side view.",
		type: "website",
	},
	twitter: {
		card: "summary_large_image",
		title: "AI Model Comparison Tool",
		description:
			"Compare LLM pricing, context, and features across providers in a side-by-side view.",
	},
};

export default function ModelsComparePage() {
	return (
		<>
			<Navbar />
			<main className="min-h-screen bg-background pt-24 md:pt-32 pb-16">
				<div className="container mx-auto px-4">
					<header className="mb-8">
						<h1 className="text-3xl md:text-4xl font-bold tracking-tight">
							Compare AI Models Side by Side
						</h1>
						<p className="mt-2 text-muted-foreground max-w-2xl">
							Select any two models to compare pricing, context window, and key
							capabilities across providers.
						</p>
					</header>
					<Suspense>
						<ModelComparison />
					</Suspense>
				</div>
			</main>
			<Footer />
		</>
	);
}
