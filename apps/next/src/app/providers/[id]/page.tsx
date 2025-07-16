import {
	models as modelDefinitions,
	providers as providerDefinitions,
} from "@llmgateway/models";
import { notFound } from "next/navigation";

import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { Hero } from "@/components/providers/hero";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { formatContextSize } from "@/lib/utils";

interface ProviderPageProps {
	params: Promise<{ id: string }>;
}

export default async function ProviderPage({ params }: ProviderPageProps) {
	const { id } = await params;

	const provider = providerDefinitions.find((p) => p.id === id);

	if (!provider || provider.name === "LLM Gateway") {
		notFound();
	}

	// Get models for this provider
	const providerModels = modelDefinitions.filter((model) =>
		model.providers.some((p) => p.providerId === provider.id),
	);

	return (
		<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
			<main>
				<Navbar />
				<Hero providerId={provider.id} />

				<section className="py-12 bg-background">
					<div className="container mx-auto px-4">
						<h2 className="text-3xl font-bold mb-8">Available Models</h2>
						<div className="grid gap-6 md:grid-cols-3">
							{providerModels.map((model) => (
								<Card key={model.model}>
									<CardHeader className="pb-2">
										<div className="flex items-start justify-between gap-2">
											<div className="flex-1 min-w-0">
												<CardTitle className="text-base leading-tight line-clamp-1">
													{model.model}
												</CardTitle>
												<CardDescription className="text-xs">
													{model.providers[0].modelName}
												</CardDescription>
											</div>
										</div>
									</CardHeader>
									<CardContent className="mt-auto space-y-2">
										{model.providers[0].contextSize && (
											<p className="text-xs text-muted-foreground">
												Context:{" "}
												<span className="font-mono text-foreground font-bold">
													{formatContextSize(model.providers[0].contextSize)}
												</span>
											</p>
										)}
										{(model.providers[0].inputPrice !== undefined ||
											model.providers[0].outputPrice !== undefined ||
											model.providers[0].requestPrice !== undefined) && (
											<p className="text-xs text-muted-foreground">
												{model.providers[0].inputPrice !== undefined && (
													<>
														<span className="font-mono text-foreground font-bold">
															$
															{(model.providers[0].inputPrice * 1e6).toFixed(2)}
														</span>{" "}
														<span className="text-muted-foreground">in</span>
													</>
												)}

												{model.providers[0].outputPrice !== undefined && (
													<>
														<span className="text-muted-foreground mx-2">
															/
														</span>
														<span className="font-mono text-foreground font-bold">
															$
															{(model.providers[0].outputPrice * 1e6).toFixed(
																2,
															)}
														</span>{" "}
														<span className="text-muted-foreground">out</span>
													</>
												)}
												{model.providers[0].requestPrice !== undefined &&
													model.providers[0].requestPrice !== 0 &&
													` / $${(model.providers[0].requestPrice * 1000).toFixed(2)} per 1K req`}
											</p>
										)}
									</CardContent>
								</Card>
							))}
						</div>
					</div>
				</section>
			</main>
			<Footer />
		</div>
	);
}

export async function generateStaticParams() {
	return providerDefinitions
		.filter((provider) => provider.name !== "LLM Gateway")
		.map((provider) => ({
			id: provider.id,
		}));
}

export async function generateMetadata({ params }: ProviderPageProps) {
	const { id } = await params;

	const provider = providerDefinitions.find((p) => p.id === id);

	if (!provider || provider.name === "LLM Gateway") {
		return {};
	}

	return {
		title: `${provider.name} - LLM Gateway`,
		description: `Learn about ${provider.name} integration with LLM Gateway. Access ${provider.name} models through our unified API.`,
		openGraph: {
			title: `${provider.name} - LLM Gateway`,
			description: `Learn about ${provider.name} integration with LLM Gateway. Access ${provider.name} models through our unified API.`,
			type: "website",
		},
		twitter: {
			card: "summary_large_image",
			title: `${provider.name} - LLM Gateway`,
			description: `Learn about ${provider.name} integration with LLM Gateway.`,
		},
	};
}
