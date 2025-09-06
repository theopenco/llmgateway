import {
	models as modelDefinitions,
	providers as providerDefinitions,
	type StabilityLevel,
	type ModelDefinition,
} from "@llmgateway/models";
import {
	AlertTriangle,
	Play,
	Zap,
	Eye,
	Wrench,
	MessageSquare,
	ImagePlus,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { CopyModelName } from "@/components/models/copy-model-name";
import { ProviderCard } from "@/components/models/provider-card";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";

interface PageProps {
	params: Promise<{ name: string }>;
}

export default async function ModelPage({ params }: PageProps) {
	const { name } = await params;
	const decodedName = decodeURIComponent(name);

	const modelDef = modelDefinitions.find(
		(m) => m.id === decodedName,
	) as ModelDefinition;

	if (!modelDef) {
		notFound();
	}

	const getStabilityBadgeProps = (stability?: StabilityLevel) => {
		switch (stability) {
			case "beta":
				return {
					variant: "secondary" as const,
					color: "text-blue-600",
					label: "BETA",
				};
			case "unstable":
				return {
					variant: "destructive" as const,
					color: "text-red-600",
					label: "UNSTABLE",
				};
			case "experimental":
				return {
					variant: "destructive" as const,
					color: "text-orange-600",
					label: "EXPERIMENTAL",
				};
			default:
				return null;
		}
	};

	const shouldShowStabilityWarning = (stability?: StabilityLevel) => {
		return stability && ["unstable", "experimental"].includes(stability);
	};

	const modelProviders = modelDef.providers.map((provider) => {
		const providerInfo = providerDefinitions.find(
			(p) => p.id === provider.providerId,
		);
		return {
			...provider,
			providerInfo,
		};
	});

	return (
		<>
			<Navbar />
			<div className="min-h-screen bg-background py-32">
				<div className="container mx-auto px-4 py-8">
					<div className="mb-8">
						<div className="flex items-center gap-3 mb-2">
							<h1 className="text-4xl font-bold tracking-tight">
								{modelDef.name}
							</h1>
							{shouldShowStabilityWarning(modelDef.stability) && (
								<AlertTriangle className="h-8 w-8 text-orange-500" />
							)}
						</div>
						<div className="flex flex-wrap items-center gap-2 mb-4">
							<CopyModelName modelName={decodedName} />
							{(() => {
								const stabilityProps = getStabilityBadgeProps(
									modelDef.stability,
								);
								return stabilityProps ? (
									<Badge
										variant={stabilityProps.variant}
										className="text-sm px-3 py-1"
									>
										{stabilityProps.label}
									</Badge>
								) : (
									<Badge variant="outline" className="text-sm px-3 py-1">
										STABLE
									</Badge>
								);
							})()}

							<Link
								href={`/playground?model=${encodeURIComponent(modelDef.id)}`}
								prefetch={true}
							>
								<Button variant="outline" size="sm" className="gap-2">
									<Play className="h-3 w-3" />
									Try in Playground
								</Button>
							</Link>
						</div>

						<div className="flex flex-wrap gap-4 text-sm text-muted-foreground mb-4">
							<span>
								{Math.max(
									...modelProviders.map((p) => p.contextSize || 0),
								).toLocaleString()}{" "}
								context
							</span>
							<span>
								Starting at $
								{(() => {
									const inputPrices = modelProviders
										.filter((p) => p.inputPrice)
										.map((p) => (p.inputPrice! * 1e6).toFixed(2))
										.map(Number);
									return inputPrices.length > 0
										? Math.min(...inputPrices)
										: "N/A";
								})()}
								/M input tokens
							</span>
							<span>
								Starting at $
								{(() => {
									const outputPrices = modelProviders
										.filter((p) => p.outputPrice)
										.map((p) => (p.outputPrice! * 1e6).toFixed(2))
										.map(Number);
									return outputPrices.length > 0
										? Math.min(...outputPrices)
										: "N/A";
								})()}
								/M output tokens
							</span>
						</div>

						<div className="flex flex-wrap items-center gap-4 mb-6">
							{(() => {
								const items: Array<{
									key: string;
									icon: any;
									label: string;
									color: string;
								}> = [];
								const hasStreaming = modelProviders.some((p) => p.streaming);
								const hasVision = modelProviders.some((p) => p.vision);
								const hasTools = modelProviders.some((p) => p.tools);
								const hasReasoning = modelProviders.some((p) => p.reasoning);
								const hasImageGen = Array.isArray((modelDef as any)?.output)
									? ((modelDef as any).output as string[]).includes("image")
									: false;

								if (hasStreaming) {
									items.push({
										key: "streaming",
										icon: Zap,
										label: "Streaming",
										color: "text-blue-500",
									});
								}
								if (hasVision) {
									items.push({
										key: "vision",
										icon: Eye,
										label: "Vision",
										color: "text-green-500",
									});
								}
								if (hasTools) {
									items.push({
										key: "tools",
										icon: Wrench,
										label: "Tools",
										color: "text-purple-500",
									});
								}
								if (hasReasoning) {
									items.push({
										key: "reasoning",
										icon: MessageSquare,
										label: "Reasoning",
										color: "text-orange-500",
									});
								}
								if (hasImageGen) {
									items.push({
										key: "image",
										icon: ImagePlus,
										label: "Image Generation",
										color: "text-pink-500",
									});
								}

								return items.map(({ key, icon: Icon, label, color }) => (
									<div
										key={key}
										className="inline-flex items-center gap-2 text-sm text-foreground"
									>
										<Icon className={`h-4 w-4 ${color}`} />
										<span className="text-muted-foreground">{label}</span>
									</div>
								));
							})()}
						</div>
					</div>

					<div className="mb-8">
						<div className="flex items-center justify-between mb-6">
							<div>
								<h2 className="text-2xl font-semibold mb-2">
									Providers for {modelDef.name}
								</h2>
								<p className="text-muted-foreground">
									LLM Gateway routes requests to the best providers that are
									able to handle your prompt size and parameters.
								</p>
							</div>
						</div>

						<div className="space-y-4">
							{modelProviders.map((provider) => (
								<ProviderCard
									key={provider.providerId}
									provider={provider}
									modelName={decodedName}
									modelStability={modelDef.stability}
								/>
							))}
						</div>
					</div>
				</div>
			</div>
			<Footer />
		</>
	);
}

export async function generateStaticParams() {
	return modelDefinitions.map((model) => ({
		name: encodeURIComponent(model.id),
	}));
}

export async function generateMetadata({ params }: PageProps) {
	const { name } = await params;
	const decodedName = decodeURIComponent(name);
	const model = modelDefinitions.find((m) => m.id === decodedName);

	if (!model) {
		return {};
	}

	return {
		title: `${model.id} - LLM Gateway`,
		description: `Explore ${model.id} across providers on LLM Gateway.`,
		openGraph: {
			title: `${model.id} - LLM Gateway`,
			description: `Explore ${model.id} across providers on LLM Gateway.`,
			type: "website",
		},
		twitter: {
			card: "summary_large_image",
			title: `${model.id} - LLM Gateway`,
			description: `Explore ${model.id} across providers.`,
		},
	};
}
