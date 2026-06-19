"use client";

import { ArrowRight, Check, Code, Copy, Sparkles, Zap } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { models, type ModelDefinition } from "@llmgateway/models";
import { getProviderIcon } from "@llmgateway/shared/components";

export type CodingModelsView = "all" | "cheap" | "flagship";

interface RecommendedModel {
	id: string;
	category: "cheap" | "flagship";
}

// Cheap models (mostly Chinese open-weights) are listed first so the default
// "all" view leads with them — we don't want to heavily promote flagship-only
// pricing on a fixed-cost DevPass plan.
const RECOMMENDED_MODELS: RecommendedModel[] = [
	{ id: "glm-5.2", category: "cheap" },
	{ id: "kimi-k2.6", category: "cheap" },
	{ id: "qwen3-coder", category: "cheap" },
	{ id: "deepseek-v4-pro", category: "cheap" },
	{ id: "claude-opus-4-8", category: "flagship" },
	{ id: "gpt-5.5", category: "flagship" },
	{ id: "gemini-3.1-pro-preview", category: "flagship" },
];

interface CodingModelsShowcaseProps {
	uiUrl: string;
	showCTA?: boolean;
	className?: string;
	showTabs?: boolean;
	defaultView?: CodingModelsView;
}

function formatContextSize(size: number): string {
	if (size >= 1000000) {
		return `${(size / 1000000).toFixed(1)}M`;
	}
	if (size >= 1000) {
		return `${(size / 1000).toFixed(0)}K`;
	}
	return size.toString();
}

type ModelProvider = ModelDefinition["providers"][number];

// Pick the provider with the lowest combined input + output price so the card
// advertises the best ("starting from") rate available for the model. Providers
// without pricing are ranked last so we still fall back to a usable mapping.
function getCheapestProvider(
	providers: readonly ModelProvider[],
): ModelProvider | undefined {
	const cost = (p: ModelProvider): number => {
		const input = p.inputPrice !== undefined ? Number(p.inputPrice) : undefined;
		const output =
			p.outputPrice !== undefined ? Number(p.outputPrice) : undefined;
		if (input === undefined && output === undefined) {
			return Number.POSITIVE_INFINITY;
		}
		return (input ?? 0) + (output ?? 0);
	};
	return providers.reduce<ModelProvider | undefined>((cheapest, p) => {
		if (!cheapest) {
			return p;
		}
		return cost(p) < cost(cheapest) ? p : cheapest;
	}, undefined);
}

function formatPrice(price: number): string {
	const perMillion = price * 1e6;
	if (perMillion < 0.01) {
		return perMillion.toFixed(4);
	}
	if (perMillion < 1) {
		return perMillion.toFixed(2);
	}
	return perMillion.toFixed(2);
}

const TAB_DEFINITIONS: {
	value: CodingModelsView;
	label: string;
	icon: React.ComponentType<{ className?: string }>;
	description: string;
}[] = [
	{
		value: "cheap",
		label: "Cheap",
		icon: Zap,
		description: "Frontier open-weight models — best price per token.",
	},
	{
		value: "flagship",
		label: "Flagship",
		icon: Sparkles,
		description: "Top-tier closed models — highest capability per call.",
	},
	{
		value: "all",
		label: "All",
		icon: Code,
		description:
			"Every recommended coding model, with cheap open-weights listed first.",
	},
];

export function CodingModelsShowcase({
	uiUrl,
	showCTA,
	className,
	showTabs = false,
	defaultView = "all",
}: CodingModelsShowcaseProps) {
	const [copiedModel, setCopiedModel] = useState<string | null>(null);
	const [view, setView] = useState<CodingModelsView>(defaultView);

	const idByCategory = new Map(
		RECOMMENDED_MODELS.map((r) => [r.id, r.category] as const),
	);
	const orderIndex = new Map(
		RECOMMENDED_MODELS.map((r, i) => [r.id, i] as const),
	);

	const filteredIds = RECOMMENDED_MODELS.filter((r) =>
		view === "all" ? true : r.category === view,
	).map((r) => r.id);

	const recommendedModels = (models as ModelDefinition[])
		.filter((m) => filteredIds.includes(m.id))
		.sort((a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0));

	const copyToClipboard = async (modelId: string) => {
		await navigator.clipboard.writeText(modelId);
		setCopiedModel(modelId);
		setTimeout(() => setCopiedModel(null), 2000);
	};

	const activeTab = TAB_DEFINITIONS.find((t) => t.value === view);

	return (
		<div className={`rounded-lg border p-6 ${className ?? ""}`}>
			<div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex items-center gap-2">
					<Code className="h-5 w-5" aria-hidden="true" />
					<p className="font-semibold">Recommended for coding agents</p>
				</div>
				{showTabs && (
					<div
						className="inline-flex items-center gap-1 rounded-lg border bg-muted/30 p-1"
						role="tablist"
						aria-label="Filter coding models"
					>
						{TAB_DEFINITIONS.map((tab) => {
							const TabIcon = tab.icon;
							const active = view === tab.value;
							return (
								<button
									key={tab.value}
									type="button"
									role="tab"
									aria-selected={active}
									onClick={() => setView(tab.value)}
									className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
										active
											? "bg-background text-foreground shadow-sm"
											: "text-muted-foreground hover:text-foreground"
									}`}
								>
									<TabIcon className="h-3.5 w-3.5" />
									{tab.label}
								</button>
							);
						})}
					</div>
				)}
			</div>
			<p className="text-sm text-muted-foreground mb-4">
				{showTabs && activeTab
					? activeTab.description
					: "High-performance models optimized for coding tasks with tool support and prompt caching."}
			</p>
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
				{recommendedModels.map((model) => {
					const provider = getCheapestProvider(model.providers);
					const ProviderIcon = provider
						? getProviderIcon(provider.providerId)
						: null;
					const category = idByCategory.get(model.id);

					return (
						<div
							key={model.id}
							className="group relative flex flex-col gap-2 rounded-lg border p-4 transition-all hover:border-primary/50 hover:shadow-sm"
						>
							{view === "all" && category === "cheap" ? (
								<span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
									<Zap className="h-2.5 w-2.5" />
									Cheap
								</span>
							) : null}
							<div className="flex items-start justify-between gap-2">
								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-2">
										{ProviderIcon && (
											<div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-muted">
												<ProviderIcon className="h-4 w-4" />
											</div>
										)}
										<span className="font-medium text-sm truncate">
											{model.name ?? model.id}
										</span>
									</div>
								</div>
							</div>

							<div className="flex items-center gap-2 mt-1">
								<code className="flex-1 text-xs bg-muted px-2 py-1 rounded font-mono truncate">
									{model.id}
								</code>
								<button
									type="button"
									onClick={() => copyToClipboard(model.id)}
									className="shrink-0 p-1 rounded hover:bg-muted transition-colors"
									title="Copy model ID"
								>
									{copiedModel === model.id ? (
										<Check className="h-3 w-3 text-green-600" />
									) : (
										<Copy className="h-3 w-3 text-muted-foreground" />
									)}
								</button>
							</div>

							{provider && (
								<div className="text-xs text-muted-foreground space-y-1 mt-1">
									{provider.contextSize && (
										<p>
											Context:{" "}
											<span className="font-mono font-medium text-foreground">
												{formatContextSize(provider.contextSize)}
											</span>
										</p>
									)}
									{(provider.inputPrice !== undefined ||
										provider.outputPrice !== undefined) && (
										<p>
											<span className="text-muted-foreground mr-1">
												starting from
											</span>
											{provider.inputPrice !== undefined && (
												<>
													<span className="font-mono font-medium text-foreground">
														${formatPrice(Number(provider.inputPrice))}
													</span>
													<span className="text-muted-foreground"> in</span>
												</>
											)}
											{provider.outputPrice !== undefined && (
												<>
													<span className="text-muted-foreground mx-1">/</span>
													<span className="font-mono font-medium text-foreground">
														${formatPrice(Number(provider.outputPrice))}
													</span>
													<span className="text-muted-foreground"> out</span>
												</>
											)}
											<span className="text-muted-foreground/70 text-[10px] ml-1">
												/M tokens
											</span>
										</p>
									)}
								</div>
							)}
						</div>
					);
				})}
			</div>
			<div className="mt-4 flex items-center justify-between">
				<a
					href={`${uiUrl}/models?category=code`}
					target="_blank"
					rel="noopener"
					className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
				>
					View all coding models
					<ArrowRight className="h-3 w-3" />
				</a>
				{showCTA && (
					<Button asChild>
						<Link href="/signup">Get Started</Link>
					</Button>
				)}
			</div>
		</div>
	);
}
