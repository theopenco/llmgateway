"use client";

import {
	ArrowRight,
	Bot,
	Code,
	DollarSign,
	FileText,
	Image,
	MessageSquare,
	Search,
	TrendingDown,
	Zap,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { ModelSelector } from "@/components/models/playground-model-selector";
import { Button } from "@/lib/components/button";
import { Card } from "@/lib/components/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import { Slider } from "@/lib/components/slider";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/lib/components/tabs";

import {
	models,
	providers,
	type ModelDefinition,
	type ProviderModelMapping,
} from "@llmgateway/models";

import type { ProviderDefinition } from "@llmgateway/models";

// ─── Derived model lists from @llmgateway/models ─────────────────────────────

const now = new Date();

const textModelDefs = (models as unknown as ModelDefinition[]).filter((m) => {
	if (m.id === "custom" || m.id === "auto") {
		return false;
	}
	if (m.output?.includes("image")) {
		return false;
	}
	const hasActiveProvider = m.providers.some(
		(p) => !p.deactivatedAt || new Date(p.deactivatedAt) > now,
	);
	return hasActiveProvider;
});

const imageModelDefs = (models as unknown as ModelDefinition[]).filter(
	(m) => m.output !== undefined && (m.output as string[]).includes("image"),
);

// ─── Helpers to extract pricing from a selected model ────────────────────────

function getModelAndMapping(selectorValue: string): {
	model: ModelDefinition;
	mapping: ProviderModelMapping;
} | null {
	if (!selectorValue) {
		return null;
	}
	const [providerId, modelId] = selectorValue.includes("/")
		? selectorValue.split("/")
		: ["", selectorValue];
	const model = models.find((m) => m.id === modelId);
	if (!model) {
		return null;
	}
	const mapping =
		model.providers.find((p) => p.providerId === providerId) ??
		model.providers[0];
	if (!mapping) {
		return null;
	}
	return { model, mapping };
}

function getImagePrice(mapping: ProviderModelMapping): {
	pricePerImage: number;
	resolutions: string[];
	getPrice: (res: string) => number;
	discount: number;
	pricingType: "per-request" | "per-token";
} {
	const discount = mapping.discount ?? 0;

	if (mapping.requestPrice && mapping.requestPrice > 0) {
		return {
			pricePerImage: mapping.requestPrice,
			resolutions: [],
			getPrice: () => mapping.requestPrice ?? 0,
			discount,
			pricingType: "per-request",
		};
	}

	if (mapping.imageOutputTokensByResolution && mapping.imageOutputPrice) {
		const resolutions = Object.keys(mapping.imageOutputTokensByResolution);
		const getPrice = (res: string) => {
			const tokens = mapping.imageOutputTokensByResolution?.[res] ?? 0;
			return tokens * (mapping.imageOutputPrice ?? 0);
		};
		return {
			pricePerImage: getPrice(resolutions[0] ?? "1K"),
			resolutions,
			getPrice,
			discount,
			pricingType: "per-token",
		};
	}

	return {
		pricePerImage: 0,
		resolutions: [],
		getPrice: () => 0,
		discount: 0,
		pricingType: "per-request",
	};
}

// ─── Use Case Presets ────────────────────────────────────────────────────────

interface UseCase {
	id: string;
	name: string;
	icon: typeof Bot;
	description: string;
	selectorValue: string;
	requestsPerDay: number;
	avgInputTokens: number;
	avgOutputTokens: number;
	cacheHitRate: number;
}

const useCases: UseCase[] = [
	{
		id: "customer-support",
		name: "Customer Support Bot",
		icon: MessageSquare,
		description:
			"Automated customer service with context-aware responses and FAQ handling",
		selectorValue: "openai/gpt-5-mini",
		requestsPerDay: 5000,
		avgInputTokens: 800,
		avgOutputTokens: 400,
		cacheHitRate: 0.45,
	},
	{
		id: "code-assistant",
		name: "Code Assistant",
		icon: Code,
		description:
			"AI-powered code completion, review, and generation for dev teams",
		selectorValue: "anthropic/claude-sonnet-4-6",
		requestsPerDay: 2000,
		avgInputTokens: 3000,
		avgOutputTokens: 2000,
		cacheHitRate: 0.25,
	},
	{
		id: "content-generation",
		name: "Content Generation",
		icon: FileText,
		description: "Blog posts, marketing copy, product descriptions at scale",
		selectorValue: "openai/gpt-5.4",
		requestsPerDay: 500,
		avgInputTokens: 1500,
		avgOutputTokens: 3000,
		cacheHitRate: 0.15,
	},
	{
		id: "rag-pipeline",
		name: "RAG Pipeline",
		icon: Search,
		description:
			"Retrieval-augmented generation for knowledge bases and document Q&A",
		selectorValue: "anthropic/claude-haiku-4-5",
		requestsPerDay: 10000,
		avgInputTokens: 4000,
		avgOutputTokens: 500,
		cacheHitRate: 0.4,
	},
	{
		id: "ai-agents",
		name: "AI Agents",
		icon: Bot,
		description:
			"Autonomous agents with tool calling for complex multi-step workflows",
		selectorValue: "anthropic/claude-opus-4-6",
		requestsPerDay: 1000,
		avgInputTokens: 5000,
		avgOutputTokens: 3000,
		cacheHitRate: 0.2,
	},
	{
		id: "data-extraction",
		name: "Data Extraction",
		icon: FileText,
		description:
			"Structured data extraction from documents, emails, and unstructured text",
		selectorValue: "openai/gpt-4.1-nano",
		requestsPerDay: 20000,
		avgInputTokens: 2000,
		avgOutputTokens: 300,
		cacheHitRate: 0.35,
	},
];

// ─── Volume Steps ────────────────────────────────────────────────────────────

const dailyVolumeSteps = [
	100, 250, 500, 1000, 2000, 5000, 10000, 25000, 50000, 100000,
];

// ─── Formatting ──────────────────────────────────────────────────────────────

function formatCurrency(value: number): string {
	if (value >= 1_000_000) {
		return `$${(value / 1_000_000).toFixed(2)}M`;
	}
	if (value >= 1_000) {
		return `$${(value / 1_000).toFixed(1)}K`;
	}
	if (value >= 1) {
		return `$${value.toFixed(2)}`;
	}
	return `$${value.toFixed(4)}`;
}

function formatNumber(value: number): string {
	if (value >= 1_000_000) {
		return `${(value / 1_000_000).toFixed(1)}M`;
	}
	if (value >= 1_000) {
		return `${(value / 1_000).toFixed(0)}K`;
	}
	return value.toLocaleString();
}

function formatPrice(price: number): string {
	return `$${(price * 1e6).toFixed(2)}`;
}

// ─── Text Cost Calculator ────────────────────────────────────────────────────

function TextSimulator() {
	const [selectedUseCase, setSelectedUseCase] = useState(useCases[0]);
	const [selectorValue, setSelectorValue] = useState(
		selectedUseCase.selectorValue,
	);
	const [volumeIndex, setVolumeIndex] = useState(
		dailyVolumeSteps.indexOf(
			dailyVolumeSteps.reduce((prev, curr) =>
				Math.abs(curr - selectedUseCase.requestsPerDay) <
				Math.abs(prev - selectedUseCase.requestsPerDay)
					? curr
					: prev,
			),
		),
	);
	const [avgInputTokens, setAvgInputTokens] = useState(
		selectedUseCase.avgInputTokens,
	);
	const [avgOutputTokens, setAvgOutputTokens] = useState(
		selectedUseCase.avgOutputTokens,
	);
	const [cacheHitRate, setCacheHitRate] = useState(
		selectedUseCase.cacheHitRate * 100,
	);

	const selected = getModelAndMapping(selectorValue);
	const mapping = selected?.mapping;
	const inputPricePerToken = mapping?.inputPrice ?? 0;
	const outputPricePerToken = mapping?.outputPrice ?? 0;
	const cachedInputPricePerToken =
		mapping?.cachedInputPrice ?? inputPricePerToken * 0.1;
	const discount = mapping?.discount ?? 0;

	const dailyRequests = dailyVolumeSteps[volumeIndex];
	const monthlyRequests = dailyRequests * 30;

	function applyUseCase(uc: UseCase) {
		setSelectedUseCase(uc);
		setSelectorValue(uc.selectorValue);
		setAvgInputTokens(uc.avgInputTokens);
		setAvgOutputTokens(uc.avgOutputTokens);
		setCacheHitRate(uc.cacheHitRate * 100);
		const closestIndex = dailyVolumeSteps.reduce(
			(bestIdx, curr, idx) =>
				Math.abs(curr - uc.requestsPerDay) <
				Math.abs(dailyVolumeSteps[bestIdx] - uc.requestsPerDay)
					? idx
					: bestIdx,
			0,
		);
		setVolumeIndex(closestIndex);
	}

	const costs = useMemo(() => {
		const cacheRate = cacheHitRate / 100;

		// Base cost per request (with caching — providers offer this natively)
		const cachedInput = avgInputTokens * cacheRate * cachedInputPricePerToken;
		const uncachedInput = avgInputTokens * (1 - cacheRate) * inputPricePerToken;
		const outputCost = avgOutputTokens * outputPricePerToken;
		const basePerRequest = cachedInput + uncachedInput + outputCost;

		// Competitors add 5.5% platform fee on top
		const baseMonthly = basePerRequest * monthlyRequests;
		const competitorMonthly = baseMonthly * 1.055;

		// LLM Gateway: same base cost, but with provider discount if available
		const gatewayPerRequest =
			discount > 0 ? basePerRequest * (1 - discount) : basePerRequest;
		const gatewayMonthly = gatewayPerRequest * monthlyRequests;

		const savingsVsCompetitor = competitorMonthly - gatewayMonthly;
		const savingsPercent =
			competitorMonthly > 0
				? ((savingsVsCompetitor / competitorMonthly) * 100).toFixed(0)
				: "0";

		return {
			basePerRequest,
			competitorMonthly,
			gatewayPerRequest,
			gatewayMonthly,
			savingsVsCompetitor,
			savingsPercent,
			yearlyVsCompetitor: savingsVsCompetitor * 12,
		};
	}, [
		inputPricePerToken,
		outputPricePerToken,
		cachedInputPricePerToken,
		discount,
		monthlyRequests,
		avgInputTokens,
		avgOutputTokens,
		cacheHitRate,
	]);

	return (
		<div className="space-y-8">
			{/* Use Case Presets */}
			<div>
				<h3 className="text-lg font-semibold mb-4">Start with a use case</h3>
				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{useCases.map((uc) => (
						<button
							key={uc.id}
							type="button"
							onClick={() => applyUseCase(uc)}
							className={`text-left p-4 rounded-xl border transition-all ${
								selectedUseCase.id === uc.id
									? "border-blue-500 bg-blue-500/5 shadow-sm shadow-blue-500/10"
									: "border-border bg-card hover:border-blue-500/30"
							}`}
						>
							<div className="flex items-start gap-3">
								<div
									className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
										selectedUseCase.id === uc.id ? "bg-blue-500/20" : "bg-muted"
									}`}
								>
									<uc.icon
										className={`h-4.5 w-4.5 ${
											selectedUseCase.id === uc.id
												? "text-blue-500"
												: "text-muted-foreground"
										}`}
									/>
								</div>
								<div className="min-w-0">
									<p className="font-medium text-sm">{uc.name}</p>
									<p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
										{uc.description}
									</p>
								</div>
							</div>
						</button>
					))}
				</div>
			</div>

			<div className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
				{/* Controls */}
				<Card className="p-6 border-border bg-card/50">
					<h3 className="text-lg font-semibold mb-6">
						Configure your scenario
					</h3>
					<div className="space-y-6">
						<div>
							<label className="text-sm font-medium mb-2 block">Model</label>
							<ModelSelector
								models={textModelDefs as ModelDefinition[]}
								providers={providers as unknown as ProviderDefinition[]}
								value={selectorValue}
								onValueChange={setSelectorValue}
								placeholder="Select a model..."
								rootOnly
							/>
							{mapping && (
								<p className="text-xs text-muted-foreground mt-2">
									{formatPrice(inputPricePerToken)}/M input &middot;{" "}
									{formatPrice(outputPricePerToken)}/M output
									{discount > 0 ? ` · ${discount * 100}% discount` : ""}
								</p>
							)}
						</div>

						<div>
							<label className="text-sm font-medium mb-2 block">
								Daily requests:{" "}
								<span className="text-blue-500">
									{formatNumber(dailyRequests)}
								</span>
								<span className="text-muted-foreground font-normal">
									{" "}
									({formatNumber(monthlyRequests)}/mo)
								</span>
							</label>
							<Slider
								value={[volumeIndex]}
								onValueChange={(v) => setVolumeIndex(v[0])}
								min={0}
								max={dailyVolumeSteps.length - 1}
								step={1}
							/>
							<div className="flex justify-between text-xs text-muted-foreground mt-2">
								<span>100/day</span>
								<span>100K/day</span>
							</div>
						</div>

						<div>
							<label className="text-sm font-medium mb-2 block">
								Avg input tokens:{" "}
								<span className="text-blue-500">
									{formatNumber(avgInputTokens)}
								</span>
							</label>
							<Slider
								value={[avgInputTokens]}
								onValueChange={(v) => setAvgInputTokens(v[0])}
								min={100}
								max={16000}
								step={100}
							/>
						</div>

						<div>
							<label className="text-sm font-medium mb-2 block">
								Avg output tokens:{" "}
								<span className="text-blue-500">
									{formatNumber(avgOutputTokens)}
								</span>
							</label>
							<Slider
								value={[avgOutputTokens]}
								onValueChange={(v) => setAvgOutputTokens(v[0])}
								min={50}
								max={8000}
								step={50}
							/>
						</div>

						<div>
							<label className="text-sm font-medium mb-2 block">
								Cache hit rate:{" "}
								<span className="text-blue-500">{cacheHitRate}%</span>
							</label>
							<Slider
								value={[cacheHitRate]}
								onValueChange={(v) => setCacheHitRate(v[0])}
								min={0}
								max={70}
								step={5}
							/>
							<p className="text-xs text-muted-foreground mt-2">
								Prompt caching reduces input costs by reusing cached prefixes.
								Typical rates: 15-45% depending on use case.
							</p>
						</div>
					</div>
				</Card>

				{/* Results */}
				<div className="space-y-4">
					<div className="grid gap-3 sm:grid-cols-3">
						<Card className="p-5 border-red-500/20 bg-red-500/5">
							<p className="text-xs font-medium text-red-600 dark:text-red-400 mb-1">
								Other Gateways
							</p>
							<p className="text-2xl font-bold text-red-600 dark:text-red-400">
								{formatCurrency(costs.competitorMonthly)}
							</p>
							<p className="text-xs text-muted-foreground mt-1">
								/month with 5.5% fee
							</p>
						</Card>

						<Card className="p-5 border-border bg-card/50">
							<p className="text-xs font-medium text-muted-foreground mb-1">
								Model Pricing
							</p>
							<div className="space-y-1 mt-2">
								<p className="text-sm font-mono">
									{formatPrice(inputPricePerToken)}/M input
								</p>
								<p className="text-sm font-mono">
									{formatPrice(outputPricePerToken)}/M output
								</p>
							</div>
						</Card>

						<Card className="p-5 border-2 border-green-500/50 bg-green-500/5 shadow-sm shadow-green-500/10">
							<p className="text-xs font-medium text-green-600 dark:text-green-400 mb-1">
								LLM Gateway
							</p>
							<p className="text-2xl font-bold text-green-600 dark:text-green-400">
								{formatCurrency(costs.gatewayMonthly)}
							</p>
							<p className="text-xs text-muted-foreground mt-1">
								/month, no markup
							</p>
						</Card>
					</div>

					<Card className="border-2 border-green-500/30 bg-gradient-to-br from-green-500/10 to-green-600/5 p-8 text-center">
						<p className="text-sm text-muted-foreground mb-2">
							Monthly savings vs other gateways
						</p>
						<p className="text-5xl sm:text-6xl font-bold text-green-600 dark:text-green-400 tracking-tight">
							{formatCurrency(costs.savingsVsCompetitor)}
						</p>
						<p className="text-lg text-green-600/80 dark:text-green-400/80 mt-2 font-medium">
							{costs.savingsPercent}% less than other gateways
							{discount > 0
								? ` (includes ${discount * 100}% provider discount)`
								: ""}
						</p>
						<div className="mt-4">
							<p className="text-xs text-muted-foreground">Annual savings</p>
							<p className="text-xl font-bold text-green-600 dark:text-green-400">
								{formatCurrency(costs.yearlyVsCompetitor)}
							</p>
						</div>
					</Card>

					<Card className="p-6 border-border">
						<h4 className="text-sm font-semibold mb-4">
							Per-request cost breakdown
						</h4>
						<div className="space-y-3">
							<div className="flex items-center justify-between text-sm">
								<span className="text-muted-foreground">
									Input ({formatNumber(avgInputTokens)} tokens @{" "}
									{formatPrice(inputPricePerToken)}/M)
								</span>
								<span className="font-mono">
									{formatCurrency(avgInputTokens * inputPricePerToken)}
								</span>
							</div>
							<div className="flex items-center justify-between text-sm">
								<span className="text-muted-foreground">
									Output ({formatNumber(avgOutputTokens)} tokens @{" "}
									{formatPrice(outputPricePerToken)}/M)
								</span>
								<span className="font-mono">
									{formatCurrency(avgOutputTokens * outputPricePerToken)}
								</span>
							</div>
							<div className="border-t border-border pt-3 flex items-center justify-between text-sm">
								<span className="text-muted-foreground">
									Base cost per request
								</span>
								<span className="font-mono font-medium">
									{formatCurrency(costs.basePerRequest)}
								</span>
							</div>
							<div className="flex items-center justify-between text-sm">
								<span className="text-green-600 dark:text-green-400">
									With caching ({cacheHitRate}% @{" "}
									{formatPrice(cachedInputPricePerToken)}/M)
									{discount > 0 ? ` + ${discount * 100}% off` : ""}
								</span>
								<span className="font-mono font-medium text-green-600 dark:text-green-400">
									{formatCurrency(costs.gatewayPerRequest)}
								</span>
							</div>
						</div>
					</Card>

					<div className="grid gap-3 sm:grid-cols-3">
						<div className="flex items-start gap-3 p-4 rounded-xl border border-border bg-card/50">
							<Zap className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
							<div>
								<p className="text-sm font-medium">Smart Caching</p>
								<p className="text-xs text-muted-foreground mt-0.5">
									Automatic prompt caching reduces repeated input costs by up to
									90%
								</p>
							</div>
						</div>
						<div className="flex items-start gap-3 p-4 rounded-xl border border-border bg-card/50">
							<TrendingDown className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
							<div>
								<p className="text-sm font-medium">Fallback Routing</p>
								<p className="text-xs text-muted-foreground mt-0.5">
									Auto-failover to cheaper providers prevents costly downtime
								</p>
							</div>
						</div>
						<div className="flex items-start gap-3 p-4 rounded-xl border border-border bg-card/50">
							<DollarSign className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
							<div>
								<p className="text-sm font-medium">No Hidden Fees</p>
								<p className="text-xs text-muted-foreground mt-0.5">
									Zero platform fees or markup on any request you make
								</p>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

// ─── Image Cost Calculator ───────────────────────────────────────────────────

function ImageSimulator() {
	const firstImage = imageModelDefs[0];
	const firstProvider = firstImage?.providers[0];
	const defaultValue = firstProvider
		? `${firstProvider.providerId}/${firstImage.id}`
		: "";

	const [selectorValue, setSelectorValue] = useState(defaultValue);
	const [resolution, setResolution] = useState("1K");
	const [imagesPerDay, setImagesPerDay] = useState(100);

	const selected = getModelAndMapping(selectorValue);
	const mapping = selected?.mapping;
	const imagePrice = mapping ? getImagePrice(mapping) : null;

	const availableResolutions = imagePrice?.resolutions ?? [];
	const validResolution =
		availableResolutions.length > 0
			? availableResolutions.includes(resolution)
				? resolution
				: availableResolutions[0]
			: "";

	const costs = useMemo(() => {
		if (!imagePrice) {
			return {
				pricePerImage: 0,
				discountedPrice: 0,
				dailyCost: 0,
				monthlyCost: 0,
				competitorMonthly: 0,
				savings: 0,
				yearlySavings: 0,
				hasDiscount: false,
			};
		}

		const pricePerImage =
			imagePrice.pricingType === "per-token" && validResolution
				? imagePrice.getPrice(validResolution)
				: imagePrice.pricePerImage;

		const hasDiscount = imagePrice.discount > 0;
		const discountedPrice = hasDiscount
			? pricePerImage * (1 - imagePrice.discount)
			: pricePerImage;

		const dailyCost = discountedPrice * imagesPerDay;
		const monthlyCost = dailyCost * 30;
		const competitorMonthly = monthlyCost * 1.055;
		const savings = competitorMonthly - monthlyCost;

		return {
			pricePerImage,
			discountedPrice,
			dailyCost,
			monthlyCost,
			competitorMonthly,
			savings,
			yearlySavings: savings * 12,
			hasDiscount,
		};
	}, [imagePrice, validResolution, imagesPerDay]);

	return (
		<div className="space-y-8">
			<div className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
				<Card className="p-6 border-border bg-card/50">
					<h3 className="text-lg font-semibold mb-6">Image generation</h3>
					<div className="space-y-6">
						<div>
							<label className="text-sm font-medium mb-2 block">Model</label>
							<ModelSelector
								models={imageModelDefs as ModelDefinition[]}
								providers={providers as unknown as ProviderDefinition[]}
								value={selectorValue}
								onValueChange={setSelectorValue}
								placeholder="Select an image model..."
								rootOnly
							/>
							{mapping && (
								<p className="text-xs text-muted-foreground mt-2">
									{imagePrice?.discount
										? ` · ${imagePrice.discount * 100}% discount`
										: ""}
									{imagePrice?.pricingType === "per-request"
										? ` · $${imagePrice.pricePerImage.toFixed(3)}/image`
										: ""}
								</p>
							)}
						</div>

						{availableResolutions.length > 0 && (
							<div>
								<label className="text-sm font-medium mb-2 block">
									Resolution
								</label>
								<Select value={validResolution} onValueChange={setResolution}>
									<SelectTrigger className="w-full bg-background h-11">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{availableResolutions.map((res) => (
											<SelectItem key={res} value={res}>
												{res}
												{res === "0.5K"
													? " (512x512)"
													: res === "1K"
														? " (1024x1024)"
														: res === "2K"
															? " (2048x2048)"
															: res === "4K"
																? " (4096x4096)"
																: ""}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						)}

						<div>
							<label className="text-sm font-medium mb-2 block">
								Images per day:{" "}
								<span className="text-blue-500">{imagesPerDay}</span>
							</label>
							<Slider
								value={[imagesPerDay]}
								onValueChange={(v) => setImagesPerDay(v[0])}
								min={10}
								max={5000}
								step={10}
							/>
							<div className="flex justify-between text-xs text-muted-foreground mt-2">
								<span>10</span>
								<span>5,000</span>
							</div>
						</div>
					</div>
				</Card>

				<div className="space-y-4">
					<div className="grid gap-3 sm:grid-cols-2">
						<Card className="p-5 border-red-500/20 bg-red-500/5">
							<p className="text-xs font-medium text-red-600 dark:text-red-400 mb-1">
								Other Gateways
							</p>
							<p className="text-2xl font-bold text-red-600 dark:text-red-400">
								{formatCurrency(costs.competitorMonthly)}
							</p>
							<p className="text-xs text-muted-foreground mt-1">/month</p>
						</Card>

						<Card className="p-5 border-2 border-green-500/50 bg-green-500/5 shadow-sm shadow-green-500/10">
							<p className="text-xs font-medium text-green-600 dark:text-green-400 mb-1">
								LLM Gateway
							</p>
							<p className="text-2xl font-bold text-green-600 dark:text-green-400">
								{formatCurrency(costs.monthlyCost)}
							</p>
							<p className="text-xs text-muted-foreground mt-1">/month</p>
						</Card>
					</div>

					<Card className="border-2 border-green-500/30 bg-gradient-to-br from-green-500/10 to-green-600/5 p-6 text-center">
						<p className="text-sm text-muted-foreground mb-1">
							Monthly savings
						</p>
						<p className="text-4xl font-bold text-green-600 dark:text-green-400 tracking-tight">
							{formatCurrency(costs.savings)}
						</p>
						<p className="text-sm text-muted-foreground mt-2">
							{formatCurrency(costs.yearlySavings)}/year saved
						</p>
					</Card>

					<Card className="p-6 border-border">
						<h4 className="text-sm font-semibold mb-4">Cost breakdown</h4>
						<div className="space-y-3">
							<div className="flex items-center justify-between text-sm">
								<span className="text-muted-foreground">
									Base price per image
								</span>
								<span className="font-mono">
									${costs.pricePerImage.toFixed(4)}
								</span>
							</div>
							{costs.hasDiscount && imagePrice && (
								<div className="flex items-center justify-between text-sm">
									<span className="text-green-600 dark:text-green-400">
										After {imagePrice.discount * 100}% discount
									</span>
									<span className="font-mono text-green-600 dark:text-green-400">
										${costs.discountedPrice.toFixed(4)}
									</span>
								</div>
							)}
							<div className="flex items-center justify-between text-sm">
								<span className="text-muted-foreground">Daily cost</span>
								<span className="font-mono">
									{formatCurrency(costs.dailyCost)}
								</span>
							</div>
							<div className="border-t border-border pt-3 flex items-center justify-between text-sm">
								<span className="text-muted-foreground">
									Monthly ({(imagesPerDay * 30).toLocaleString()} images)
								</span>
								<span className="font-mono font-medium">
									{formatCurrency(costs.monthlyCost)}
								</span>
							</div>
						</div>
					</Card>
				</div>
			</div>
		</div>
	);
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function CostSimulatorClient() {
	return (
		<div className="pt-32 pb-20 sm:pt-40 sm:pb-28">
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				<div className="mx-auto max-w-3xl text-center mb-16">
					<div className="mb-6 inline-flex items-center gap-2 rounded-full border border-green-500/30 bg-green-500/10 px-4 py-1.5">
						<TrendingDown className="h-3.5 w-3.5 text-green-500" />
						<span className="text-xs font-medium text-green-600 dark:text-green-400">
							Interactive Cost Simulator
						</span>
					</div>
					<h1 className="mb-6 text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">
						Know exactly what you&apos;ll save
					</h1>
					<p className="text-lg text-muted-foreground text-balance leading-relaxed max-w-2xl mx-auto">
						Configure your use case, pick a model, set your volume, and see the
						real cost difference. No guesswork, no surprises.
					</p>
				</div>

				<div className="mx-auto max-w-6xl">
					<Tabs defaultValue="text" className="gap-6">
						<div className="flex justify-center">
							<TabsList className="h-11">
								<TabsTrigger value="text" className="px-6">
									<MessageSquare className="h-4 w-4 mr-2" />
									Text / Chat
								</TabsTrigger>
								<TabsTrigger value="image" className="px-6">
									<Image className="h-4 w-4 mr-2" />
									Image Generation
								</TabsTrigger>
							</TabsList>
						</div>

						<TabsContent value="text">
							<TextSimulator />
						</TabsContent>

						<TabsContent value="image">
							<ImageSimulator />
						</TabsContent>
					</Tabs>
				</div>

				<div className="mx-auto max-w-3xl mt-20 space-y-6">
					<Card className="p-6 sm:p-8 border-border bg-gradient-to-br from-muted/50 to-muted/30">
						<div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
							<div className="flex-1 text-center sm:text-left">
								<p className="text-lg font-semibold">Processing high volume?</p>
								<p className="text-sm text-muted-foreground mt-1">
									Enterprise plans include volume discounts, dedicated support,
									custom SLAs, and extended data retention.
								</p>
							</div>
							<Button
								size="lg"
								variant="outline"
								className="shrink-0 bg-transparent"
								asChild
							>
								<Link href="/enterprise#contact">
									Talk to Sales
									<ArrowRight className="ml-2 h-4 w-4" />
								</Link>
							</Button>
						</div>
					</Card>

					<Card className="p-8 sm:p-10 border-blue-500/30 bg-gradient-to-br from-blue-500/5 to-blue-600/5 text-center">
						<h2 className="text-2xl sm:text-3xl font-bold mb-3 text-balance">
							Ready to cut your LLM costs?
						</h2>
						<p className="text-muted-foreground mb-6 text-balance leading-relaxed">
							Start for free with no platform fees. No credit card required.
						</p>
						<div className="flex flex-col sm:flex-row gap-3 justify-center">
							<Button size="lg" asChild>
								<Link href="/signup">
									Get Started Free
									<ArrowRight className="ml-2 h-4 w-4" />
								</Link>
							</Button>
							<Button
								size="lg"
								variant="outline"
								className="bg-transparent"
								asChild
							>
								<Link href="/enterprise#contact">Book a Demo</Link>
							</Button>
						</div>
					</Card>
				</div>
			</div>
		</div>
	);
}
