"use client";

import { ArrowRight, DollarSign, TrendingDown, Zap } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { ModelSelector } from "@/components/models/playground-model-selector";
import { Button } from "@/lib/components/button";
import { Card } from "@/lib/components/card";
import { Slider } from "@/lib/components/slider";

import { models, providers } from "@llmgateway/models";

import type {
	ModelDefinition,
	ProviderDefinition,
	ProviderModelMapping,
} from "@llmgateway/models";

const now = new Date();

const textModelDefs = (models as unknown as ModelDefinition[]).filter((m) => {
	if (m.id === "custom" || m.id === "auto") {
		return false;
	}
	if (m.output?.includes("image")) {
		return false;
	}
	return m.providers.some(
		(p) => !p.deactivatedAt || new Date(p.deactivatedAt) > now,
	);
});

const COMPETITOR_FEE = 0.055;

function formatCurrency(value: number): string {
	if (value >= 1_000_000) {
		return `$${(value / 1_000_000).toFixed(1)}M`;
	}
	if (value >= 1_000) {
		return `$${(value / 1_000).toFixed(1)}K`;
	}
	return `$${value.toFixed(2)}`;
}

function formatNumber(value: number): string {
	if (value >= 1_000_000) {
		return `${(value / 1_000_000).toFixed(1)}M`;
	}
	if (value >= 1_000) {
		return `${(value / 1_000).toFixed(0)}K`;
	}
	return value.toString();
}

function formatPrice(price: number): string {
	return `$${(price * 1e6).toFixed(2)}`;
}

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

const dailyVolumeSteps = [
	1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000,
];

export function CostCalculator() {
	const [selectorValue, setSelectorValue] = useState(
		"aws-bedrock/claude-sonnet-4-6",
	);
	const [volumeIndex, setVolumeIndex] = useState(3);
	const [avgInputTokens, setAvgInputTokens] = useState(3000);
	const [avgOutputTokens, setAvgOutputTokens] = useState(500);
	const [cacheHitRate, setCacheHitRate] = useState(30);

	const selected = getModelAndMapping(selectorValue);
	const mapping = selected?.mapping;
	const inputPricePerToken = mapping?.inputPrice ?? 0;
	const outputPricePerToken = mapping?.outputPrice ?? 0;
	const cachedInputPricePerToken =
		mapping?.cachedInputPrice ?? inputPricePerToken * 0.1;
	const discount = mapping?.discount ?? 0;

	const dailyRequests = dailyVolumeSteps[volumeIndex];
	const monthlyRequests = dailyRequests * 30;

	const costs = useMemo(() => {
		const cacheRate = cacheHitRate / 100;

		const cachedInputCost =
			avgInputTokens * cacheRate * cachedInputPricePerToken;
		const uncachedInputCost =
			avgInputTokens * (1 - cacheRate) * inputPricePerToken;
		const outputCost = avgOutputTokens * outputPricePerToken;
		const basePerRequest = cachedInputCost + uncachedInputCost + outputCost;

		const baseMonthly = basePerRequest * monthlyRequests;
		const competitorCost = baseMonthly * (1 + COMPETITOR_FEE);

		const gatewayPerRequest =
			discount > 0 ? basePerRequest * (1 - discount) : basePerRequest;
		const gatewayCost = gatewayPerRequest * monthlyRequests;

		const competitorSavings = competitorCost - gatewayCost;
		const savingsPercent =
			competitorCost > 0
				? ((competitorSavings / competitorCost) * 100).toFixed(0)
				: "0";

		return {
			competitorCost,
			gatewayCost,
			competitorSavings,
			savingsPercent,
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
		<section className="py-20 sm:py-28 bg-muted/30" id="calculator">
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				<div className="mx-auto max-w-2xl text-center mb-16">
					<div className="mb-6 inline-flex items-center gap-2 rounded-full border border-green-500/30 bg-green-500/10 px-4 py-1.5">
						<TrendingDown className="h-3.5 w-3.5 text-green-500" />
						<span className="text-xs font-medium text-green-600 dark:text-green-400">
							Cost Savings Calculator
						</span>
					</div>
					<h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl text-balance">
						See how much you could save
					</h2>
					<p className="text-lg text-muted-foreground text-balance leading-relaxed">
						Companies switching to LLM Gateway save up to 35% on LLM costs
						through smart provider routing, volume discounts, and zero platform
						fees.
					</p>
				</div>

				<div className="mx-auto max-w-5xl">
					<Card className="p-6 sm:p-8 border-border bg-card">
						<div className="grid gap-8 lg:grid-cols-[1fr_1.5fr]">
							{/* Controls */}
							<div className="space-y-6">
								<div>
									<label className="text-sm font-medium mb-3 block">
										Model
									</label>
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
											{formatPrice(inputPricePerToken)}
											/M input &middot; {formatPrice(outputPricePerToken)}/M
											output
											{discount > 0 ? ` · ${discount * 100}% discount` : ""}
										</p>
									)}
								</div>

								<div>
									<label className="text-sm font-medium mb-3 block">
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
										<span>1K/day</span>
										<span>1M/day</span>
									</div>
								</div>

								<div>
									<label className="text-sm font-medium mb-3 block">
										Avg input tokens:{" "}
										<span className="text-blue-500">
											{formatNumber(avgInputTokens)}
										</span>
									</label>
									<Slider
										value={[avgInputTokens]}
										onValueChange={(v) => setAvgInputTokens(v[0])}
										min={100}
										max={50000}
										step={100}
									/>
								</div>

								<div>
									<label className="text-sm font-medium mb-3 block">
										Avg output tokens:{" "}
										<span className="text-blue-500">
											{formatNumber(avgOutputTokens)}
										</span>
									</label>
									<Slider
										value={[avgOutputTokens]}
										onValueChange={(v) => setAvgOutputTokens(v[0])}
										min={50}
										max={16000}
										step={50}
									/>
								</div>

								<div>
									<label className="text-sm font-medium mb-3 block">
										Cache hit rate:{" "}
										<span className="text-blue-500">{cacheHitRate}%</span>
									</label>
									<Slider
										value={[cacheHitRate]}
										onValueChange={(v) => setCacheHitRate(v[0])}
										min={0}
										max={80}
										step={5}
									/>
									<div className="flex justify-between text-xs text-muted-foreground mt-2">
										<span>0%</span>
										<span>80%</span>
									</div>
								</div>
							</div>

							{/* Results */}
							<div className="space-y-4">
								<div className="grid gap-3 sm:grid-cols-3">
									<div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
										<p className="text-xs font-medium text-red-600 dark:text-red-400 mb-1">
											Other Gateways
										</p>
										<p className="text-xl font-bold text-red-600 dark:text-red-400">
											{formatCurrency(costs.competitorCost)}
										</p>
										<p className="text-xs text-muted-foreground mt-1">
											5.5% platform fee
										</p>
									</div>

									<div className="rounded-xl border border-border bg-muted/50 p-4">
										<p className="text-xs font-medium text-muted-foreground mb-1">
											Model Pricing
										</p>
										<div className="space-y-1 mt-1">
											<p className="text-sm font-mono">
												{formatPrice(inputPricePerToken)}/M input
											</p>
											<p className="text-sm font-mono">
												{formatPrice(outputPricePerToken)}/M output
											</p>
										</div>
									</div>

									<div className="rounded-xl border-2 border-green-500/50 bg-green-500/5 p-4 shadow-sm shadow-green-500/10">
										<p className="text-xs font-medium text-green-600 dark:text-green-400 mb-1">
											LLM Gateway
										</p>
										<p className="text-xl font-bold text-green-600 dark:text-green-400">
											{formatCurrency(costs.gatewayCost)}
										</p>
										<p className="text-xs text-muted-foreground mt-1">
											No markup
											{discount > 0 ? `, ${discount * 100}% off` : ""}
										</p>
									</div>
								</div>

								<div className="rounded-2xl border-2 border-green-500/30 bg-gradient-to-br from-green-500/10 to-green-600/5 p-6 text-center">
									<p className="text-sm text-muted-foreground mb-1">
										Your estimated monthly savings
									</p>
									<p className="text-4xl sm:text-5xl font-bold text-green-600 dark:text-green-400 tracking-tight">
										{formatCurrency(costs.competitorSavings)}
									</p>
									<p className="text-sm text-green-600/80 dark:text-green-400/80 mt-2">
										{costs.savingsPercent}% less than other gateways
									</p>
									<div className="mt-4 flex items-center justify-center gap-4 text-xs text-muted-foreground">
										<span className="flex items-center gap-1">
											<Zap className="h-3.5 w-3.5 text-blue-500" />
											Smart routing
										</span>
										<span className="flex items-center gap-1">
											<DollarSign className="h-3.5 w-3.5 text-blue-500" />
											No hidden fees
										</span>
									</div>
								</div>

								<p className="text-center text-sm text-muted-foreground">
									That&apos;s{" "}
									<span className="font-semibold text-foreground">
										{formatCurrency(costs.competitorSavings * 12)}/year
									</span>{" "}
									you&apos;re leaving on the table.
								</p>

								<div className="flex flex-col sm:flex-row gap-3 pt-2">
									<Button size="lg" className="flex-1" asChild>
										<Link href="/enterprise#contact">
											Book a Demo
											<ArrowRight className="ml-2 h-4 w-4" />
										</Link>
									</Button>
									<Button
										size="lg"
										variant="outline"
										className="flex-1 bg-transparent"
										asChild
									>
										<Link href="/cost-simulator">Full Cost Simulator</Link>
									</Button>
								</div>
							</div>
						</div>
					</Card>
				</div>
			</div>
		</section>
	);
}
