"use client";

import { ArrowRight, Check, Code, Copy } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { models, type ModelDefinition } from "@llmgateway/models";
import { getProviderIcon } from "@llmgateway/shared/components";

const RECOMMENDED_MODEL_IDS: string[] = [
	"claude-opus-4-5-20251101",
	"gemini-3-pro-preview",
	"glm-4.7",
	"qwen3-coder",
	"minimax-m2.1",
	"grok-4-1-fast-reasoning",
	"grok-code-fast-1",
];

interface CodingModelsShowcaseProps {
	uiUrl: string;
	showCTA?: boolean;
	className?: string;
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

export function CodingModelsShowcase({
	uiUrl,
	showCTA,
	className,
}: CodingModelsShowcaseProps) {
	const [copiedModel, setCopiedModel] = useState<string | null>(null);

	const recommendedModels = (models as ModelDefinition[]).filter((m) =>
		RECOMMENDED_MODEL_IDS.includes(m.id),
	);

	const copyToClipboard = async (modelId: string) => {
		await navigator.clipboard.writeText(modelId);
		setCopiedModel(modelId);
		setTimeout(() => setCopiedModel(null), 2000);
	};

	return (
		<div className={`rounded-lg border p-6 ${className ?? ""}`}>
			<div className="flex items-center gap-2 mb-4">
				<Code className="h-5 w-5" />
				<h3 className="font-semibold">Recommended Coding Models</h3>
			</div>
			<p className="text-sm text-muted-foreground mb-4">
				High-performance models optimized for coding tasks with tool support and
				prompt caching.
			</p>
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
				{recommendedModels.map((model) => {
					const provider = model.providers[0];
					const ProviderIcon = provider
						? getProviderIcon(provider.providerId)
						: null;

					return (
						<div
							key={model.id}
							className="group flex flex-col gap-2 rounded-lg border p-4 transition-all hover:border-primary/50 hover:shadow-sm"
						>
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
											{provider.inputPrice !== undefined && (
												<>
													<span className="font-mono font-medium text-foreground">
														${formatPrice(provider.inputPrice)}
													</span>
													<span className="text-muted-foreground"> in</span>
												</>
											)}
											{provider.outputPrice !== undefined && (
												<>
													<span className="text-muted-foreground mx-1">/</span>
													<span className="font-mono font-medium text-foreground">
														${formatPrice(provider.outputPrice)}
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
					rel="noopener noreferrer"
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
