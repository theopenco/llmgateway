import {
	models as modelDefinitions,
	providers as providerDefinitions,
} from "@llmgateway/models";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, GitBranch, Copy, Check } from "lucide-react";
import { useState } from "react";

import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { Hero } from "@/components/providers/hero";
import { ProductHuntBanner } from "@/components/shared/product-hunt-banner";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { formatContextSize } from "@/lib/utils";

export const Route = createFileRoute("/providers/$id")({
	component: ProviderPage,
	loader: ({ params }: { params: { id: string } }) => {
		const provider = providerDefinitions.find((p) => p.id === params.id);
		if (!provider || provider.name === "LLM Gateway") {
			throw new Error("Provider not found");
		}
		return provider;
	},
	head: ({ loaderData }) => {
		if (!loaderData) {
			return { title: "Provider - LLM Gateway" };
		}
		return {
			title: `${loaderData.name} Provider - LLM Gateway`,
			meta: [
				{ name: "description", content: loaderData.description },
				{
					property: "og:title",
					content: `${loaderData.name} Provider - LLM Gateway`,
				},
				{ property: "og:description", content: loaderData.description },
				{
					property: "og:image",
					content: `/providers/${loaderData.id}.png`,
				},
				{ property: "og:type", content: "website" },
				{
					property: "og:url",
					content: `https://llmgateway.io/providers/${loaderData.id}`,
				},
				{ name: "twitter:card", content: "summary_large_image" },
				{
					name: "twitter:title",
					content: `${loaderData.name} Provider - LLM Gateway`,
				},
				{ name: "twitter:description", content: loaderData.description },
				{
					name: "twitter:image",
					content: `/providers/${loaderData.id}.png`,
				},
			],
		};
	},
});

function ProviderPage() {
	const provider = Route.useLoaderData();
	const [copiedModel, setCopiedModel] = useState<string | null>(null);

	const copyModelName = async (modelName: string) => {
		try {
			await navigator.clipboard.writeText(modelName);
			setCopiedModel(modelName);
			setTimeout(() => setCopiedModel(null), 2000);
		} catch (err) {
			console.error("Failed to copy model name:", err);
		}
	};

	const providerModels = modelDefinitions
		.filter((m) => m.providers.some((p) => p.providerId === provider.id))
		.map((m) => {
			const providerModel = m.providers.find(
				(p) => p.providerId === provider.id,
			)!;
			const tags = [];
			if ("jsonOutput" in m && m.jsonOutput) {
				tags.push("JSON Output");
			}
			if (providerModel.streaming) {
				tags.push("Streaming");
			}
			if (providerModel.contextSize) {
				tags.push(`${formatContextSize(providerModel.contextSize)} context`);
			}

			return {
				id: m.id,
				name: (m as any).displayName || m.id,
				description: `${m.id} model from ${provider.name}`,
				tags,
				contextSize: providerModel.contextSize,
				inputPrice: providerModel.inputPrice,
				outputPrice: providerModel.outputPrice,
				requestPrice: providerModel.requestPrice,
				status: "active",
			};
		});

	return (
		<>
			<ProductHuntBanner />
			<Navbar />
			<Hero providerId={provider.id} />
			<div className="mx-auto px-6 lg:px-0 container py-8">
				<div className="flex justify-between flex-col md:flex-row items-center mb-8">
					<h2 className="text-2xl font-bold mb-4 md:mb-0">Available Models</h2>
					<div className="flex gap-2">
						<Button variant="outline" size="sm" asChild>
							<a
								href="https://github.com/theopenco/llmgateway/issues/new?assignees=&labels=enhancement%2Cmodel-request&projects=&template=model-request.md&title=%5BModel+Request%5D+"
								target="_blank"
								rel="noopener noreferrer"
								className="inline-flex items-center gap-2"
							>
								<Plus className="h-4 w-4" />
								Request Model
							</a>
						</Button>
						<Button variant="outline" size="sm" asChild>
							<a
								href="https://github.com/theopenco/llmgateway/issues/new?assignees=&labels=enhancement%2Cprovider-request&projects=&template=provider-request.md&title=%5BProvider+Request%5D+"
								target="_blank"
								rel="noopener noreferrer"
								className="inline-flex items-center gap-2"
							>
								<GitBranch className="h-4 w-4" />
								Request Provider
							</a>
						</Button>
					</div>
				</div>
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
					{providerModels.map((model) => (
						<Card
							key={model.id}
							className="flex flex-col h-full hover:shadow-md transition-shadow"
						>
							<CardHeader className="pb-2">
								<div className="flex items-start justify-between gap-2">
									<div className="flex-1 min-w-0">
										<CardTitle className="text-base leading-tight line-clamp-1">
											{model.name}
										</CardTitle>
										<CardDescription className="text-xs">
											{provider.name}
										</CardDescription>
									</div>
									<Button
										variant="ghost"
										size="sm"
										className="h-6 w-6 p-0 shrink-0"
										onClick={() => copyModelName(model.name)}
										title="Copy model name"
									>
										{copiedModel === model.name ? (
											<Check className="h-3 w-3 text-green-600" />
										) : (
											<Copy className="h-3 w-3" />
										)}
									</Button>
								</div>
							</CardHeader>
							<CardContent className="mt-auto space-y-2">
								<div className="flex flex-wrap gap-2">
									{model.tags.map((tag) => (
										<Badge key={tag} variant="secondary">
											{tag}
										</Badge>
									))}
								</div>
								{model.contextSize && (
									<p className="text-xs text-muted-foreground">
										Context:{" "}
										<span className="font-mono text-foreground font-bold">
											{formatContextSize(model.contextSize)}
										</span>
									</p>
								)}
								{(model.inputPrice !== undefined ||
									model.outputPrice !== undefined) && (
									<p className="text-xs text-muted-foreground">
										{model.inputPrice !== undefined && (
											<>
												<span className="font-mono text-foreground font-bold">
													${(model.inputPrice * 1e6).toFixed(2)}
												</span>{" "}
												<span className="text-muted-foreground">in</span>
											</>
										)}

										{model.outputPrice !== undefined && (
											<>
												<span className="text-muted-foreground mx-2">/</span>
												<span className="font-mono text-foreground font-bold">
													${(model.outputPrice * 1e6).toFixed(2)}
												</span>{" "}
												<span className="text-muted-foreground">out</span>
											</>
										)}
									</p>
								)}
							</CardContent>
						</Card>
					))}
				</div>
			</div>
			<Footer />
		</>
	);
}
