"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import React, { useMemo, type ReactNode, useRef, useState } from "react";

import { ModelSelector as PlaygroundModelSelector } from "@/components/models/playground-model-selector";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/lib/components/table";
import Logo from "@/lib/icons/Logo";
import { formatContextSize } from "@/lib/utils";

import {
	models,
	providers as providerDefinitions,
	type ModelDefinition,
	type ProviderModelMapping,
	type StabilityLevel,
} from "@llmgateway/models";

type ModelId = (typeof models)[number]["id"];

const DEFAULT_LEFT_MODEL = "gpt-4o" as ModelId;
const DEFAULT_RIGHT_MODEL = "claude-3-7-sonnet" as ModelId;

const providerMap = new Map(
	providerDefinitions.map((provider) => [provider.id, provider]),
);

const modelMap = new Map(models.map((model) => [model.id, model]));

function parseProviderModel(value: string | null): {
	providerId?: string;
	modelId?: ModelId;
} {
	if (!value) {
		return {};
	}
	if (value.includes("_")) {
		const [providerId, model] = value.split("_");
		return { providerId, modelId: toModelId(model) };
	}
	return { modelId: toModelId(value) };
}

function toModelId(value: string | null): ModelId | undefined {
	if (!value) {
		return undefined;
	}

	return modelMap.has(value as ModelId) ? (value as ModelId) : undefined;
}

type PriceField =
	| "inputPrice"
	| "outputPrice"
	| "cachedInputPrice"
	| "requestPrice"
	| "imageInputPrice";

type ProviderWithInfo = ProviderModelMapping & {
	providerInfo?: (typeof providerDefinitions)[number];
};

interface PricingSummary {
	value: string;
	providerLabel: string;
	originalValue?: string;
}

interface ModelDetail {
	id: string;
	displayName: string;
	family: string;
	aliases?: string[];
	model: ModelDefinition;
	providers: ProviderWithInfo[];
	stability?: StabilityLevel;
	jsonOutput: boolean;
	aggregated: {
		streaming: boolean;
		vision: boolean;
		reasoning: boolean;
		tools: boolean;
		parallelToolCalls: boolean;
		maxContext?: number;
		maxOutput?: number;
		supportedParameters: string[];
		inputPrice?: PricingSummary;
		outputPrice?: PricingSummary;
		cachedInputPrice?: PricingSummary;
		requestPrice?: PricingSummary;
		imageInputPrice?: PricingSummary;
	};
}

const stabilityLabels: Record<StabilityLevel, string> = {
	stable: "Stable",
	beta: "Beta",
	unstable: "Unstable",
	experimental: "Experimental",
};

type ComparisonRowKey =
	| "modelId"
	| "family"
	| "aliases"
	| "stability"
	| "providers"
	| "maxContext"
	| "maxOutput"
	| "inputPrice"
	| "outputPrice"
	| "cachedInputPrice"
	| "imageInputPrice"
	| "requestPrice"
	| "streaming"
	| "vision"
	| "tools"
	| "parallelToolCalls"
	| "reasoning"
	| "jsonOutput"
	| "supportedParameters";

const groupedRows: Array<{
	title: string;
	rows: Array<{ key: ComparisonRowKey; label: string }>;
}> = [
	{
		title: "Overview",
		rows: [
			{ key: "modelId", label: "Model ID" },
			{ key: "family", label: "Family" },
			{ key: "aliases", label: "Aliases" },
			{ key: "stability", label: "Stability" },
			{ key: "providers", label: "Providers" },
		],
	},
	{
		title: "Pricing",
		rows: [
			{ key: "inputPrice", label: "Input Price" },
			{ key: "outputPrice", label: "Output Price" },
			{ key: "cachedInputPrice", label: "Cached Input Price" },
			{ key: "imageInputPrice", label: "Image Input Price" },
			{ key: "requestPrice", label: "Request Price" },
		],
	},
	{
		title: "Context",
		rows: [
			{ key: "maxContext", label: "Max Context" },
			{ key: "maxOutput", label: "Max Output" },
		],
	},
	{
		title: "Capabilities",
		rows: [
			{ key: "streaming", label: "Streaming" },
			{ key: "vision", label: "Vision" },
			{ key: "tools", label: "Tool Calling" },
			{ key: "parallelToolCalls", label: "Parallel Tool Calls" },
			{ key: "reasoning", label: "Reasoning" },
			{ key: "jsonOutput", label: "JSON Output" },
		],
	},
	{
		title: "Parameters",
		rows: [{ key: "supportedParameters", label: "Supported Parameters" }],
	},
];

const PLACEHOLDER: ReactNode = <span className="text-muted-foreground">—</span>;

function pickMostUnstableStability(
	model: ModelDefinition,
): StabilityLevel | undefined {
	const precedence: StabilityLevel[] = [
		"experimental",
		"unstable",
		"beta",
		"stable",
	];

	const stabilities = [
		model.stability,
		...model.providers.map((provider) => provider.stability ?? model.stability),
	].filter(Boolean) as StabilityLevel[];

	for (const level of precedence) {
		if (stabilities.includes(level)) {
			return level;
		}
	}

	return undefined;
}

function formatPriceValue(value: number, field: PriceField) {
	// Value is already in units based on field multiplier.
	// For tokens pricing, show 2 decimals, for very small numbers bump precision.
	const decimals = value < 1 ? (value < 0.1 ? 4 : 2) : 2;
	const formatted = `$${value.toFixed(decimals)}`;

	if (field === "requestPrice") {
		return `${formatted}/1K requests`;
	}
	if (field === "imageInputPrice") {
		return `${formatted}/image`;
	}
	return `${formatted}/1M tokens`;
}

function getPricingSummary(
	providers: ProviderWithInfo[],
	field: PriceField,
): PricingSummary | undefined {
	const entries = providers
		.filter(
			(provider) => provider[field] !== undefined && provider[field] !== null,
		)
		.map((provider) => {
			const rawValue = provider[field] as number;
			const multiplier =
				field === "requestPrice"
					? 1000
					: field === "imageInputPrice"
						? 1
						: 1_000_000;
			const discounted =
				rawValue * multiplier * (provider.discount ? 1 - provider.discount : 1);
			const original = rawValue * multiplier;

			return {
				provider,
				discounted,
				original,
				hasDiscount: Boolean(provider.discount),
			};
		});

	if (!entries.length) {
		return undefined;
	}

	const best = entries.reduce((currentBest, candidate) => {
		if (!currentBest) {
			return candidate;
		}
		return candidate.discounted < currentBest.discounted
			? candidate
			: currentBest;
	});

	return {
		value: formatPriceValue(best.discounted, field),
		providerLabel:
			best.provider.providerInfo?.name ?? best.provider.providerId ?? "Unknown",
		originalValue:
			best.hasDiscount && best.original !== best.discounted
				? formatPriceValue(best.original, field)
				: undefined,
	};
}

function collectModelDetail(modelId?: ModelId): ModelDetail | undefined {
	if (!modelId) {
		return undefined;
	}
	const model = modelMap.get(modelId) as ModelDefinition | undefined;

	if (!model) {
		return undefined;
	}

	const providersWithInfo = model.providers.map((provider) => ({
		...provider,
		providerInfo: providerMap.get(provider.providerId),
	}));

	const aggregated = {
		streaming: providersWithInfo.some((provider) => provider.streaming),
		vision: providersWithInfo.some((provider) => provider.vision),
		reasoning: providersWithInfo.some((provider) => provider.reasoning),
		tools: providersWithInfo.some((provider) => provider.tools),
		parallelToolCalls: providersWithInfo.some(
			(provider) => provider.parallelToolCalls,
		),
		maxContext: providersWithInfo.reduce<number | undefined>(
			(acc, provider) => {
				if (provider.contextSize) {
					return Math.max(acc ?? 0, provider.contextSize);
				}
				return acc;
			},
			undefined,
		),
		maxOutput: providersWithInfo.reduce<number | undefined>((acc, provider) => {
			if (provider.maxOutput) {
				return Math.max(acc ?? 0, provider.maxOutput);
			}
			return acc;
		}, undefined),
		supportedParameters: Array.from(
			new Set(
				providersWithInfo.flatMap(
					(provider) => provider.supportedParameters ?? [],
				),
			),
		).sort(),
		inputPrice: getPricingSummary(providersWithInfo, "inputPrice"),
		outputPrice: getPricingSummary(providersWithInfo, "outputPrice"),
		cachedInputPrice: getPricingSummary(providersWithInfo, "cachedInputPrice"),
		requestPrice: getPricingSummary(providersWithInfo, "requestPrice"),
		imageInputPrice: getPricingSummary(providersWithInfo, "imageInputPrice"),
	};

	return {
		id: model.id,
		displayName: model.name ?? model.id,
		family: model.family,
		aliases: model.aliases,
		model,
		providers: providersWithInfo,
		stability: pickMostUnstableStability(model),
		jsonOutput: Boolean(model.jsonOutput),
		aggregated,
	};
}

function BooleanBadge({ value }: { value: boolean | undefined }) {
	if (value) {
		return (
			<Badge variant="secondary" className="px-2 py-0 text-xs">
				Yes
			</Badge>
		);
	}

	return (
		<Badge variant="outline" className="px-2 py-0 text-xs">
			No
		</Badge>
	);
}

function StabilityBadge({ stability }: { stability?: StabilityLevel }) {
	if (!stability) {
		return (
			<Badge variant="outline" className="text-xs">
				Stable
			</Badge>
		);
	}

	const variant =
		stability === "beta"
			? "secondary"
			: stability === "stable"
				? "outline"
				: "destructive";

	return (
		<Badge variant={variant} className="text-xs">
			{stabilityLabels[stability]}
		</Badge>
	);
}

function ProvidersList({ providers }: { providers: ProviderWithInfo[] }) {
	if (!providers.length) {
		return <span className="text-muted-foreground">—</span>;
	}

	return (
		<div className="flex flex-col gap-2">
			{providers.map((provider) => (
				<div
					key={`${provider.providerId}-${provider.modelName}`}
					className="space-y-1"
				>
					<div className="flex items-center gap-2 text-sm">
						<span
							className="h-2 w-2 rounded-full"
							style={{
								backgroundColor: provider.providerInfo?.color || "#9ca3af",
							}}
						/>
						<span className="font-medium">
							{provider.providerInfo?.name ?? provider.providerId}
						</span>
					</div>
					<div className="text-xs text-muted-foreground">
						API: {provider.providerId}/{provider.modelName}
					</div>
				</div>
			))}
		</div>
	);
}

function PricingCell({ summary }: { summary?: PricingSummary }) {
	if (!summary) {
		return <span className="text-muted-foreground">—</span>;
	}

	return (
		<div className="flex flex-col gap-1 text-sm">
			<div className="font-medium">{summary.value}</div>
			<div className="text-xs text-muted-foreground">
				via {summary.providerLabel}
			</div>
			{summary.originalValue && summary.originalValue !== summary.value ? (
				<div className="text-xs text-muted-foreground line-through">
					{summary.originalValue}
				</div>
			) : null}
		</div>
	);
}

function ParametersList({ parameters }: { parameters: string[] }) {
	if (!parameters.length) {
		return <span className="text-muted-foreground">—</span>;
	}

	return (
		<div className="flex flex-wrap gap-2">
			{parameters.map((parameter) => (
				<Badge key={parameter} variant="outline" className="text-xs font-mono">
					{parameter}
				</Badge>
			))}
		</div>
	);
}

function getProviderPricingSummary(
	provider: ProviderWithInfo | undefined,
	field: PriceField,
): PricingSummary | undefined {
	if (!provider) {
		return undefined;
	}
	const raw = provider[field] as number | undefined;
	if (raw === undefined || raw === null) {
		return undefined;
	}
	const multiplier =
		field === "requestPrice"
			? 1000
			: field === "imageInputPrice"
				? 1
				: 1_000_000;
	const discounted =
		raw * multiplier * (provider.discount ? 1 - provider.discount : 1);
	const original = raw * multiplier;
	return {
		value: formatPriceValue(discounted, field),
		providerLabel: provider.providerInfo?.name ?? provider.providerId,
		originalValue:
			provider.discount && original !== discounted
				? formatPriceValue(original, field)
				: undefined,
	};
}

function renderRowValue(
	key: ComparisonRowKey,
	detail: ModelDetail | undefined,
	selectedProviderId?: string,
): ReactNode {
	if (!detail) {
		return PLACEHOLDER;
	}

	const selectedProvider = selectedProviderId
		? detail.providers.find((p) => p.providerId === selectedProviderId)
		: undefined;

	switch (key) {
		case "modelId":
			return detail.id;
		case "family":
			return detail.family;
		case "aliases":
			return detail.aliases && detail.aliases.length
				? detail.aliases.join(", ")
				: PLACEHOLDER;
		case "stability":
			return <StabilityBadge stability={detail.stability} />;
		case "providers":
			return <ProvidersList providers={detail.providers} />;
		case "maxContext": {
			const ctx = selectedProvider?.contextSize ?? detail.aggregated.maxContext;
			return ctx ? formatContextSize(ctx) : PLACEHOLDER;
		}
		case "maxOutput": {
			const out = selectedProvider?.maxOutput ?? detail.aggregated.maxOutput;
			return out ? out.toLocaleString() : PLACEHOLDER;
		}
		case "inputPrice": {
			const summary =
				getProviderPricingSummary(selectedProvider, "inputPrice") ||
				detail.aggregated.inputPrice;
			return <PricingCell summary={summary} />;
		}
		case "outputPrice": {
			const summary =
				getProviderPricingSummary(selectedProvider, "outputPrice") ||
				detail.aggregated.outputPrice;
			return <PricingCell summary={summary} />;
		}
		case "cachedInputPrice": {
			const summary =
				getProviderPricingSummary(selectedProvider, "cachedInputPrice") ||
				detail.aggregated.cachedInputPrice;
			return <PricingCell summary={summary} />;
		}
		case "imageInputPrice": {
			const summary =
				getProviderPricingSummary(selectedProvider, "imageInputPrice") ||
				detail.aggregated.imageInputPrice;
			return <PricingCell summary={summary} />;
		}
		case "requestPrice": {
			const summary =
				getProviderPricingSummary(selectedProvider, "requestPrice") ||
				detail.aggregated.requestPrice;
			return <PricingCell summary={summary} />;
		}
		case "streaming":
			return <BooleanBadge value={detail.aggregated.streaming} />;
		case "vision":
			return <BooleanBadge value={detail.aggregated.vision} />;
		case "tools":
			return <BooleanBadge value={detail.aggregated.tools} />;
		case "parallelToolCalls":
			return <BooleanBadge value={detail.aggregated.parallelToolCalls} />;
		case "reasoning":
			return <BooleanBadge value={detail.aggregated.reasoning} />;
		case "jsonOutput":
			return <BooleanBadge value={detail.jsonOutput} />;
		case "supportedParameters":
			return (
				<ParametersList parameters={detail.aggregated.supportedParameters} />
			);
		default:
			return PLACEHOLDER;
	}
}

export function ModelComparison() {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const searchParamsString = searchParams.toString();

	const containerRef = useRef<HTMLDivElement | null>(null);
	const [isCapturing, setIsCapturing] = useState(false);

	const fallbackLeftModel = modelMap.has(DEFAULT_LEFT_MODEL)
		? DEFAULT_LEFT_MODEL
		: (models[0]?.id as ModelId | undefined);
	const fallbackRightModel = modelMap.has(DEFAULT_RIGHT_MODEL)
		? DEFAULT_RIGHT_MODEL
		: (models[1]?.id as ModelId | undefined);

	const { providerId: queryLeftProviderId, modelId: queryLeft } =
		parseProviderModel(searchParams.get("left"));
	const { providerId: queryRightProviderId, modelId: queryRight } =
		parseProviderModel(searchParams.get("right"));

	const leftModelId: ModelId | undefined = queryLeft ?? fallbackLeftModel;
	const rightModelId: ModelId | undefined = queryRight ?? fallbackRightModel;

	const updateParams = (
		nextLeft?: ModelId,
		nextRight?: ModelId,
		leftProviderId?: string,
		rightProviderId?: string,
	) => {
		const params = new URLSearchParams(searchParamsString);
		if (nextLeft) {
			const providerId =
				leftProviderId ??
				modelMap.get(nextLeft)?.providers[0]?.providerId ??
				"";
			params.set("left", `${providerId}_${nextLeft}`);
		} else {
			params.delete("left");
		}
		if (nextRight) {
			const providerId =
				rightProviderId ??
				modelMap.get(nextRight)?.providers[0]?.providerId ??
				"";
			params.set("right", `${providerId}_${nextRight}`);
		} else {
			params.delete("right");
		}
		const next = params.toString();
		if (next !== searchParamsString) {
			router.replace(next ? `${pathname}?${next}` : pathname, {
				scroll: false,
			});
		}
	};

	const leftModel = useMemo(
		() => collectModelDetail(leftModelId),
		[leftModelId],
	);
	const rightModel = useMemo(
		() => collectModelDetail(rightModelId),
		[rightModelId],
	);

	const buildPlaygroundUrl = (providerId?: string, modelId?: string) => {
		if (!modelId) {
			return "/playground";
		}
		const modelParam = providerId ? `${providerId}/${modelId}` : modelId;
		const base =
			process.env.NODE_ENV === "development"
				? "http://localhost:3003"
				: "https://chat.llmgateway.io";
		return `${base}/?model=${encodeURIComponent(modelParam)}`;
	};

	return (
		<div ref={containerRef} className="relative space-y-8 bg-background">
			<Card>
				<CardHeader className="space-y-4">
					<div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
						<div>
							<CardTitle className="text-2xl md:text-3xl">
								Compare AI Models
							</CardTitle>
							<CardDescription>
								Select any two models from the directory to compare pricing,
								context window, and key platform features side by side.
							</CardDescription>
						</div>
						<div className="flex items-center gap-2">
							<Button
								variant="outline"
								size="sm"
								onClick={() => updateParams(rightModelId, leftModelId)}
								className="w-full md:w-auto"
							>
								Swap Models
							</Button>
							<Button
								size="sm"
								onClick={async () => {
									if (isCapturing) {
										return;
									}
									setIsCapturing(true);
									try {
										const { toPng } = await import("html-to-image");
										const node = containerRef.current;
										if (!node) {
											return;
										}
										const dataUrl = await toPng(node, {
											cacheBust: true,
											pixelRatio: 2,
										});
										const a = document.createElement("a");
										a.href = dataUrl;
										a.download = "model-comparison.png";
										a.click();
									} finally {
										setIsCapturing(false);
									}
								}}
								className="w-full md:w-auto"
							>
								Download PNG
							</Button>
						</div>
					</div>
					<div className="grid gap-4 md:grid-cols-2">
						<div className="space-y-2 md:pl-48">
							<div className="text-sm font-medium text-muted-foreground">
								Model A
							</div>
							<PlaygroundModelSelector
								models={models}
								providers={providerDefinitions}
								value={
									leftModelId
										? `${
												queryLeftProviderId ??
												providerDefinitions.find(
													(p) =>
														p.id ===
														modelMap.get(leftModelId)?.providers[0]?.providerId,
												)?.id ??
												""
											}/${leftModelId}`
										: ""
								}
								onValueChange={(value) => {
									const [prov, mod] = value.split("/");
									const next = toModelId(mod ?? value) ?? fallbackLeftModel;
									updateParams(next, rightModelId, prov, undefined);
								}}
							/>
						</div>
						<div className="space-y-2 md:pl-24">
							<div className="text-sm font-medium text-muted-foreground">
								Model B
							</div>
							<PlaygroundModelSelector
								models={models}
								providers={providerDefinitions}
								value={
									rightModelId
										? `${
												queryRightProviderId ??
												providerDefinitions.find(
													(p) =>
														p.id ===
														modelMap.get(rightModelId)?.providers[0]
															?.providerId,
												)?.id ??
												""
											}/${rightModelId}`
										: ""
								}
								onValueChange={(value) => {
									const [prov, mod] = value.split("/");
									const next = toModelId(mod ?? value) ?? fallbackRightModel;
									updateParams(leftModelId, next, undefined, prov);
								}}
							/>
						</div>
					</div>
					<div className="grid gap-4 md:grid-cols-2">
						<div className="flex items-center gap-3 md:pl-48">
							{leftModel && (
								<>
									<Button asChild size="sm" variant="outline">
										<Link href={`/models/${encodeURIComponent(leftModel.id)}`}>
											Learn more
										</Link>
									</Button>
									<Button asChild size="sm">
										<a
											href={buildPlaygroundUrl(
												queryLeftProviderId ||
													leftModel.providers[0]?.providerId,
												leftModel.id,
											)}
											target="_blank"
											rel="noopener noreferrer"
										>
											Playground
										</a>
									</Button>
								</>
							)}
						</div>
						<div className="flex items-center gap-3 md:pl-24">
							{rightModel && (
								<>
									<Button asChild size="sm" variant="outline">
										<Link href={`/models/${encodeURIComponent(rightModel.id)}`}>
											Learn more
										</Link>
									</Button>
									<Button asChild size="sm">
										<a
											href={buildPlaygroundUrl(
												queryRightProviderId ||
													rightModel.providers[0]?.providerId,
												rightModel.id,
											)}
											target="_blank"
											rel="noopener noreferrer"
										>
											Playground
										</a>
									</Button>
								</>
							)}
						</div>
					</div>
				</CardHeader>
				<CardContent>
					<div className="overflow-x-auto">
						<Table className="table-fixed min-w-[900px] md:min-w-0">
							<TableHeader>
								<TableRow>
									<TableHead className="w-36 md:w-48">Feature</TableHead>
									<TableHead className="w-1/2">
										<div className="flex items-center gap-2">
											<div className="flex flex-col">
												<span className="font-semibold">
													{leftModel?.displayName ?? "Select a model"}
												</span>
												{leftModel ? (
													<Link
														href={`/models/${encodeURIComponent(leftModel.id)}`}
														className="text-xs text-primary hover:underline"
													>
														View model details
													</Link>
												) : null}
											</div>
											<StabilityBadge stability={leftModel?.stability} />
										</div>
									</TableHead>
									<TableHead className="w-1/2">
										<div className="flex items-center gap-2">
											<div className="flex flex-col">
												<span className="font-semibold">
													{rightModel?.displayName ?? "Select a model"}
												</span>
												{rightModel ? (
													<Link
														href={`/models/${encodeURIComponent(rightModel.id)}`}
														className="text-xs text-primary hover:underline"
													>
														View model details
													</Link>
												) : null}
											</div>
											<StabilityBadge stability={rightModel?.stability} />
										</div>
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{groupedRows.map((group) => (
									<React.Fragment key={`grp-${group.title}`}>
										<TableRow>
											<TableCell
												colSpan={3}
												className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground"
											>
												{group.title}
											</TableCell>
										</TableRow>
										{group.rows.map((row) => (
											<TableRow key={row.key}>
												<TableCell className="font-medium text-xs md:text-base">
													{row.label}
												</TableCell>
												<TableCell className="align-top whitespace-normal break-words pr-4">
													{renderRowValue(
														row.key,
														leftModel,
														queryLeftProviderId,
													)}
												</TableCell>
												<TableCell className="align-top whitespace-normal break-words">
													{renderRowValue(
														row.key,
														rightModel,
														queryRightProviderId,
													)}
												</TableCell>
											</TableRow>
										))}
									</React.Fragment>
								))}
							</TableBody>
						</Table>
					</div>
				</CardContent>
			</Card>
			{isCapturing ? (
				<div className="pointer-events-none flex justify-center z-50">
					<div className="bg-background/90 backdrop-blur border rounded-full px-6 py-3 text-base md:text-lg flex items-center gap-3 md:gap-4 shadow-md">
						<span className="text-muted-foreground">Powered by</span>
						<Logo className="h-6 w-6 md:h-7 md:w-7" />
						<span className="font-semibold tracking-tight">LLMGateway</span>
					</div>
				</div>
			) : null}
		</div>
	);
}
