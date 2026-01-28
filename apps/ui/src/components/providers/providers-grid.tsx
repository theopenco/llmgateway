"use client";

import { ExternalLink, ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";

import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";

import {
	models as modelDefinitions,
	providers as providerDefinitions,
	type ProviderId,
} from "@llmgateway/models";
import { providerLogoUrls } from "@llmgateway/shared/components";

const getProviderLogo = (providerId: ProviderId) => {
	const LogoComponent = providerLogoUrls[providerId];

	if (LogoComponent) {
		return <LogoComponent className="h-12 w-12 object-contain" />;
	}

	return <div className="h-12 w-12 bg-muted rounded-lg" />;
};

const getModelsCountByProvider = () => {
	const counts: Record<string, number> = {};

	for (const model of modelDefinitions) {
		for (const providerMapping of model.providers) {
			const providerId = providerMapping.providerId;
			counts[providerId] = (counts[providerId] || 0) + 1;
		}
	}

	return counts;
};

const modelCounts = getModelsCountByProvider();

const sortedProviders = [...providerDefinitions]
	.filter((p) => p.name !== "LLM Gateway" && p.id !== "custom")
	.sort((a, b) => {
		const countA = modelCounts[a.id] || 0;
		const countB = modelCounts[b.id] || 0;
		return countB - countA;
	});

const totalModels = modelDefinitions.length;
const totalProviders = sortedProviders.length;

export function ProvidersGrid() {
	const router = useRouter();

	return (
		<div className="container mx-auto px-4 pt-60 pb-8">
			<header className="text-center mb-12">
				<h1 className="text-4xl font-bold tracking-tight mb-4">AI Providers</h1>
				<p className="text-xl text-muted-foreground mb-6 max-w-3xl mx-auto">
					Access {totalModels} models from {totalProviders} leading AI providers
					through our unified API
				</p>
				<div className="flex justify-center gap-8 text-sm text-muted-foreground">
					<div className="flex items-center gap-2">
						<div className="w-2 h-2 bg-green-500 rounded-full" />
						<span>{totalProviders} Providers</span>
					</div>
					<div className="flex items-center gap-2">
						<div className="w-2 h-2 bg-blue-500 rounded-full" />
						<span>{totalModels} Models</span>
					</div>
				</div>
			</header>

			<div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
				{sortedProviders.map((provider) => {
					const modelsCount = modelCounts[provider.id] || 0;

					return (
						<Card
							key={provider.id}
							className="h-full transition-all hover:shadow-md hover:border-primary/50 group cursor-pointer"
							onClick={() => router.push(`/providers/${provider.id}`)}
						>
							<CardHeader className="space-y-4">
								<div className="flex items-start justify-between">
									{getProviderLogo(provider.id as ProviderId)}
									<div className="flex items-center gap-1 text-sm text-muted-foreground group-hover:text-primary transition-colors">
										<span>View models</span>
										<ArrowRight className="h-4 w-4" />
									</div>
								</div>
								<div>
									<CardTitle className="text-xl mb-2">
										{provider.name}
									</CardTitle>
									<CardDescription className="line-clamp-2">
										{provider.description}
									</CardDescription>
								</div>
								<div className="flex items-center justify-between pt-2 border-t">
									<span className="text-sm font-medium">
										{modelsCount} model{modelsCount !== 1 ? "s" : ""}
									</span>
									{provider.website && (
										<a
											href={provider.website}
											target="_blank"
											rel="noopener noreferrer"
											onClick={(e) => e.stopPropagation()}
											className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
										>
											<ExternalLink className="h-3 w-3" />
											Website
										</a>
									)}
								</div>
							</CardHeader>
						</Card>
					);
				})}
			</div>
		</div>
	);
}
