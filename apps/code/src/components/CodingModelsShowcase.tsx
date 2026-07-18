"use client";

import {
	ArrowRight,
	Check,
	Code,
	Copy,
	Gem,
	List,
	Sparkles,
	Zap,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { models, type ModelDefinition } from "@llmgateway/models";
import { isPremiumModel } from "@llmgateway/shared";
import {
	getModelFamilyIcon,
	OPEN_WEIGHT_LAB_FAMILIES,
} from "@llmgateway/shared/components";

export type CodingModelsView = "recommended" | "standard" | "premium" | "all";

interface CodingModelsShowcaseProps {
	showCTA?: boolean;
	className?: string;
	showTabs?: boolean;
	defaultView?: CodingModelsView;
}

type ModelProvider = ModelDefinition["providers"][number];

function isActiveMapping(provider: ModelProvider): boolean {
	const now = new Date();
	return (
		(!provider.deprecatedAt || provider.deprecatedAt > now) &&
		(!provider.deactivatedAt || provider.deactivatedAt > now)
	);
}

// Mirrors the `category=code` filter on the models directory: paid, stable
// models with at least one active mapping offering tools, JSON output,
// streaming, and cached input pricing.
function isCodingModel(model: ModelDefinition): boolean {
	if (model.free) {
		return false;
	}
	if (model.stability === "unstable" || model.stability === "experimental") {
		return false;
	}
	return model.providers.some(
		(p) =>
			isActiveMapping(p) &&
			(p.jsonOutput ?? p.jsonOutputSchema) &&
			p.tools &&
			p.streaming &&
			p.cachedInputPrice !== undefined,
	);
}

// Newest release first; models without a release date sink to the end.
function byNewestRelease(a: ModelDefinition, b: ModelDefinition): number {
	const aTime = a.releasedAt?.getTime() ?? 0;
	const bTime = b.releasedAt?.getTime() ?? 0;
	return bTime - aTime;
}

const codingModels = (models as ModelDefinition[])
	.filter(isCodingModel)
	.sort(byNewestRelease);

// Recommended = the latest coding model from each open-weight lab, derived
// from release dates so new catalogue entries surface without curation.
const recommendedIds: ReadonlySet<string> = (() => {
	const latestPerFamily = new Map<string, ModelDefinition>();
	for (const model of codingModels) {
		if (!OPEN_WEIGHT_LAB_FAMILIES.has(model.family) || !model.releasedAt) {
			continue;
		}
		const current = latestPerFamily.get(model.family);
		if (!current || model.releasedAt > current.releasedAt!) {
			latestPerFamily.set(model.family, model);
		}
	}
	return new Set(Array.from(latestPerFamily.values()).map((model) => model.id));
})();

const premiumIds: ReadonlySet<string> = new Set(
	codingModels.filter((m) => isPremiumModel(m.id)).map((m) => m.id),
);

function formatContextSize(size: number): string {
	if (size >= 1000000) {
		return `${(size / 1000000).toFixed(1)}M`;
	}
	if (size >= 1000) {
		return `${(size / 1000).toFixed(0)}K`;
	}
	return size.toString();
}

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
		value: "recommended",
		label: "Recommended",
		icon: Sparkles,
		description:
			"The latest open-weight lab models — the best value for coding agents.",
	},
	{
		value: "standard",
		label: "Standard",
		icon: Zap,
		description: "No weekly cap — use them as far as your plan credits go.",
	},
	{
		value: "premium",
		label: "Premium",
		icon: Gem,
		description:
			"Flagship models covered by the weekly premium fair-use allowance.",
	},
	{
		value: "all",
		label: "All",
		icon: List,
		description: "Every coding-capable model on LLM Gateway.",
	},
];

export function CodingModelsShowcase({
	showCTA,
	className,
	showTabs = false,
	defaultView = "recommended",
}: CodingModelsShowcaseProps) {
	const [copiedModel, setCopiedModel] = useState<string | null>(null);
	const [view, setView] = useState<CodingModelsView>(defaultView);

	const visibleModels = codingModels.filter((model) => {
		if (view === "recommended") {
			return recommendedIds.has(model.id);
		}
		if (view === "standard") {
			return !premiumIds.has(model.id);
		}
		if (view === "premium") {
			return premiumIds.has(model.id);
		}
		return true;
	});

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
					<p className="font-semibold">
						{showTabs ? "Coding models" : "Recommended for coding agents"}
					</p>
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
					: "The latest open-weight-lab models — high performance on coding tasks with tool support and prompt caching."}
			</p>
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
				{visibleModels.map((model) => {
					const provider = getCheapestProvider(
						model.providers.filter(isActiveMapping),
					);
					const FamilyIcon = getModelFamilyIcon(model.family);

					return (
						<div
							key={model.id}
							className="group relative flex flex-col gap-2 rounded-lg border p-4 transition-all hover:border-primary/50 hover:shadow-sm"
						>
							{premiumIds.has(model.id) ? (
								<span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
									<Gem className="h-2.5 w-2.5" />
									Premium
								</span>
							) : null}
							<div className="flex items-start justify-between gap-2">
								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-2">
										<div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-muted">
											<FamilyIcon className="h-4 w-4" />
										</div>
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
				<Link
					href="/models"
					className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
				>
					Browse the full directory
					<ArrowRight className="h-3 w-3" />
				</Link>
				{showCTA && (
					<Button asChild>
						<Link href="/signup">Get Started</Link>
					</Button>
				)}
			</div>
		</div>
	);
}
