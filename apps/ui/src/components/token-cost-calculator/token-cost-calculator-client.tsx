"use client";

import {
	ArrowRight,
	Calculator,
	Check,
	Copy,
	FileText,
	Linkedin,
	Plus,
	Share2,
	SlidersHorizontal,
	X,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { ModelSelector } from "@/components/models/playground-model-selector";
import { Button } from "@/lib/components/button";
import { Card } from "@/lib/components/card";
import { Input } from "@/lib/components/input";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/lib/components/tabs";
import { XIcon } from "@/lib/icons/XIcon";

import {
	providers,
	type ModelDefinition,
	type ProviderModelMapping,
} from "@llmgateway/models";

import {
	computeRowCost,
	formatPricePerMillion,
	formatTokenCount,
	formatUsd,
	getCheapestProvider,
	getModelById,
	getOfficialProvider,
	getProviderName,
	getTextModels,
	parseModelFromSelector,
} from "./calc-utils";

import type { ProviderDefinition } from "@llmgateway/models";

// The tokenizer chunk ships ~1 MB of BPE ranks; load it lazily so it never
// blocks the page's LCP. The estimator tab below stays in the light bundle.
const TokenizerPanel = dynamic(
	() => import("./tokenizer-panel").then((m) => m.TokenizerPanel),
	{
		ssr: false,
		loading: () => <TokenizerPanelSkeleton />,
	},
);

const textModelDefs = getTextModels();

// ─── Types ──────────────────────────────────────────────────────────────────

interface ModelRow {
	id: string;
	selectorValue: string;
	inputTokens: number;
	outputTokens: number;
}

let rowCounter = 0;

const TOKEN_PRESETS = [
	{ label: "Light (10K/1K)", input: 10_000, output: 1_000 },
	{ label: "Medium (100K/10K)", input: 100_000, output: 10_000 },
	{ label: "Heavy (1M/100K)", input: 1_000_000, output: 100_000 },
	{ label: "Intensive (10M/1M)", input: 10_000_000, output: 1_000_000 },
];

// ─── Main Component ─────────────────────────────────────────────────────────

export function TokenCostCalculatorClient() {
	return (
		<div className="relative overflow-hidden pt-32 pb-20 sm:pt-40 sm:pb-28">
			{/* Decorative backdrop */}
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-0 -z-10"
			>
				<div className="absolute left-1/2 top-0 h-[420px] w-full max-w-[820px] -translate-x-1/2 rounded-full bg-blue-500/10 blur-3xl" />
				<div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-500/40 to-transparent" />
			</div>
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				{/* Header */}
				<div className="mx-auto max-w-3xl text-center mb-12 sm:mb-16">
					<div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-4 py-1.5">
						<Calculator className="h-3.5 w-3.5 text-blue-500" />
						<span className="text-xs font-medium text-blue-600 dark:text-blue-400">
							Free LLM Token Cost Calculator
						</span>
					</div>
					<h1 className="mb-6 text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">
						Count your tokens. Compare every model&apos;s cost.
					</h1>
					<p className="text-lg text-muted-foreground text-balance leading-relaxed max-w-2xl mx-auto">
						Paste any prompt to get its exact token count, then see what it
						costs on GPT-5, Claude, Gemini, and 280+ models — priced at each
						provider&apos;s cheapest live rate with zero platform markup.
					</p>
					<div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
						<span className="flex items-center gap-1.5">
							<Check className="h-4 w-4 text-green-500" />
							Real tokenizer, in your browser
						</span>
						<span className="flex items-center gap-1.5">
							<Check className="h-4 w-4 text-green-500" />
							280+ models
						</span>
						<span className="flex items-center gap-1.5">
							<Check className="h-4 w-4 text-green-500" />
							Free, no signup
						</span>
					</div>
				</div>

				<div className="mx-auto max-w-5xl">
					<Tabs defaultValue="tokens" className="gap-8">
						<div className="flex justify-center">
							<TabsList className="h-11">
								<TabsTrigger value="tokens" className="px-5">
									<FileText className="h-4 w-4 mr-2" />
									Count from text
								</TabsTrigger>
								<TabsTrigger value="estimate" className="px-5">
									<SlidersHorizontal className="h-4 w-4 mr-2" />
									Estimate by volume
								</TabsTrigger>
							</TabsList>
						</div>

						<TabsContent value="tokens">
							<TokenizerPanel />
						</TabsContent>

						<TabsContent value="estimate">
							<EstimatePanel />
						</TabsContent>
					</Tabs>

					{/* Shared CTA */}
					<div className="mt-16 space-y-6">
						<Card className="p-6 sm:p-8 border-border bg-gradient-to-br from-muted/50 to-muted/30">
							<div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
								<div className="flex-1 text-center sm:text-left">
									<p className="text-lg font-semibold">
										Processing high volume?
									</p>
									<p className="text-sm text-muted-foreground mt-1">
										Enterprise plans include volume discounts, dedicated
										support, custom SLAs, and extended data retention.
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
		</div>
	);
}

function TokenizerPanelSkeleton() {
	return (
		<div className="space-y-6">
			<Card className="p-5 sm:p-6 border-border bg-card/50">
				<div className="h-4 w-56 rounded bg-muted animate-pulse" />
				<div className="mt-3 h-[160px] w-full rounded-md bg-muted/60 animate-pulse" />
				<div className="mt-4 grid grid-cols-3 gap-3">
					{[0, 1, 2].map((i) => (
						<div
							key={i}
							className="h-16 rounded-lg bg-muted/60 animate-pulse"
						/>
					))}
				</div>
			</Card>
		</div>
	);
}

// ─── Estimate Panel (manual volume entry) ────────────────────────────────────

function EstimatePanel() {
	const [rows, setRows] = useState<ModelRow[]>(() => [
		{
			id: `row-${++rowCounter}`,
			selectorValue: "openai/gpt-4o-mini",
			inputTokens: 1_000_000,
			outputTokens: 100_000,
		},
	]);

	const addRow = useCallback(() => {
		setRows((prev) => [
			...prev,
			{
				id: `row-${++rowCounter}`,
				selectorValue: "",
				inputTokens: 1_000_000,
				outputTokens: 100_000,
			},
		]);
	}, []);

	const removeRow = useCallback((id: string) => {
		setRows((prev) =>
			prev.length > 1 ? prev.filter((r) => r.id !== id) : prev,
		);
	}, []);

	const updateRow = useCallback(
		(id: string, update: Partial<Omit<ModelRow, "id">>) => {
			setRows((prev) =>
				prev.map((r) => (r.id === id ? { ...r, ...update } : r)),
			);
		},
		[],
	);

	const calculations = useMemo(() => {
		let officialTotal = 0;
		let gatewayTotal = 0;

		const rowDetails = rows.map((row) => {
			const parsed = parseModelFromSelector(row.selectorValue);
			const model = parsed ? getModelById(parsed.modelId) : undefined;
			if (!model) {
				return {
					row,
					model: null,
					officialMapping: null,
					cheapestMapping: null,
					officialCost: 0,
					gatewayCost: 0,
				};
			}

			const cost = computeRowCost(model, row.inputTokens, row.outputTokens);
			officialTotal += cost.officialCost;
			gatewayTotal += cost.gatewayCost;

			return {
				row,
				model,
				officialMapping: cost.officialMapping ?? null,
				cheapestMapping: cost.cheapestMapping ?? null,
				officialCost: cost.officialCost,
				gatewayCost: cost.gatewayCost,
			};
		});

		const savings = officialTotal - gatewayTotal;
		const savingsPercent =
			officialTotal > 0 ? ((savings / officialTotal) * 100).toFixed(1) : "0";

		return { rowDetails, officialTotal, gatewayTotal, savings, savingsPercent };
	}, [rows]);

	return (
		<div className="space-y-6">
			{rows.map((row, index) => (
				<ModelRowCard
					key={row.id}
					row={row}
					index={index}
					canRemove={rows.length > 1}
					onUpdate={updateRow}
					onRemove={removeRow}
				/>
			))}

			<button
				type="button"
				onClick={addRow}
				className="w-full flex items-center justify-center gap-2 py-4 rounded-xl border-2 border-dashed border-border hover:border-blue-500/50 hover:bg-blue-500/5 transition-all text-muted-foreground hover:text-blue-500"
			>
				<Plus className="h-4 w-4" />
				<span className="text-sm font-medium">Add another model</span>
			</button>

			<ResultsPanel calculations={calculations} />
		</div>
	);
}

// ─── Model Row Card ─────────────────────────────────────────────────────────

function ModelRowCard({
	row,
	index,
	canRemove,
	onUpdate,
	onRemove,
}: {
	row: ModelRow;
	index: number;
	canRemove: boolean;
	onUpdate: (id: string, update: Partial<Omit<ModelRow, "id">>) => void;
	onRemove: (id: string) => void;
}) {
	const parsed = parseModelFromSelector(row.selectorValue);
	const model = parsed ? getModelById(parsed.modelId) : undefined;
	const officialMapping = model ? getOfficialProvider(model) : undefined;
	const cheapestMapping = model
		? getCheapestProvider(model, row.inputTokens, row.outputTokens)
		: undefined;

	const handlePreset = (preset: (typeof TOKEN_PRESETS)[number]) => {
		onUpdate(row.id, {
			inputTokens: preset.input,
			outputTokens: preset.output,
		});
	};

	return (
		<Card className="p-5 sm:p-6 border-border bg-card/50 relative group">
			{canRemove && (
				<button
					type="button"
					onClick={() => onRemove(row.id)}
					className="absolute top-3 right-3 p-1.5 rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-500/10 focus-visible:opacity-100 focus-visible:text-red-500 focus-visible:bg-red-500/10 transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
					aria-label="Remove model"
				>
					<X className="h-4 w-4" />
				</button>
			)}

			<div className="flex items-center gap-2 mb-4">
				<div className="flex h-6 w-6 items-center justify-center rounded-md bg-muted text-xs font-bold text-muted-foreground">
					{index + 1}
				</div>
				<span className="text-sm font-medium text-muted-foreground">
					{model?.name ?? "Select a model"}
				</span>
			</div>

			<div className="grid gap-4 sm:grid-cols-[1fr_1fr_1fr] items-end">
				<div>
					<label
						htmlFor={`model-${row.id}`}
						className="text-xs font-medium text-muted-foreground mb-1.5 block"
					>
						Model
					</label>
					<ModelSelector
						models={textModelDefs as ModelDefinition[]}
						providers={providers as unknown as ProviderDefinition[]}
						value={row.selectorValue}
						onValueChange={(val) => onUpdate(row.id, { selectorValue: val })}
						placeholder="Select model..."
						rootOnly
						id={`model-${row.id}`}
					/>
				</div>

				<div>
					<label
						htmlFor={`inputTokens-${row.id}`}
						className="text-xs font-medium text-muted-foreground mb-1.5 block"
					>
						Input tokens
					</label>
					<Input
						id={`inputTokens-${row.id}`}
						type="number"
						min={0}
						step={1000}
						value={row.inputTokens}
						onChange={(e) =>
							onUpdate(row.id, {
								inputTokens: Math.max(0, Number(e.target.value) || 0),
							})
						}
						className="h-10 font-mono text-sm"
					/>
				</div>

				<div>
					<label
						htmlFor={`outputTokens-${row.id}`}
						className="text-xs font-medium text-muted-foreground mb-1.5 block"
					>
						Output tokens
					</label>
					<Input
						id={`outputTokens-${row.id}`}
						type="number"
						min={0}
						step={1000}
						value={row.outputTokens}
						onChange={(e) =>
							onUpdate(row.id, {
								outputTokens: Math.max(0, Number(e.target.value) || 0),
							})
						}
						className="h-10 font-mono text-sm"
					/>
				</div>
			</div>

			<div className="mt-3 flex flex-wrap gap-1.5">
				{TOKEN_PRESETS.map((preset) => (
					<button
						key={preset.label}
						type="button"
						onClick={() => handlePreset(preset)}
						className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
							row.inputTokens === preset.input &&
							row.outputTokens === preset.output
								? "border-blue-500/50 bg-blue-500/10 text-blue-600 dark:text-blue-400"
								: "border-border text-muted-foreground hover:border-blue-500/30 hover:text-foreground"
						}`}
					>
						{preset.label}
					</button>
				))}
			</div>

			{model && officialMapping && cheapestMapping && (
				<div className="mt-4 pt-4 border-t border-border grid gap-3 sm:grid-cols-2">
					<div className="flex items-center justify-between sm:justify-start gap-4">
						<div>
							<p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
								Official ({getProviderName(officialMapping.providerId)})
							</p>
							<p className="text-sm font-mono mt-0.5">
								<span className="text-muted-foreground">
									{formatPricePerMillion(
										Number(officialMapping.inputPrice ?? "0"),
									)}
									/M in
								</span>
								{" · "}
								<span className="text-muted-foreground">
									{formatPricePerMillion(
										Number(officialMapping.outputPrice ?? "0"),
									)}
									/M out
								</span>
							</p>
						</div>
					</div>
					<div className="flex items-center justify-between sm:justify-start gap-4">
						<div>
							<p className="text-[11px] font-medium text-green-600 dark:text-green-400 uppercase tracking-wider">
								LLM Gateway ({getProviderName(cheapestMapping.providerId)})
							</p>
							<p className="text-sm font-mono mt-0.5">
								<span className="text-green-600 dark:text-green-400">
									{formatPricePerMillion(
										Number(cheapestMapping.inputPrice ?? "0"),
									)}
									/M in
								</span>
								{" · "}
								<span className="text-green-600 dark:text-green-400">
									{formatPricePerMillion(
										Number(cheapestMapping.outputPrice ?? "0"),
									)}
									/M out
								</span>
							</p>
						</div>
					</div>
				</div>
			)}
		</Card>
	);
}

// ─── Results Panel ──────────────────────────────────────────────────────────

function ResultsPanel({
	calculations,
}: {
	calculations: {
		rowDetails: Array<{
			row: ModelRow;
			model: ModelDefinition | null;
			officialMapping: ProviderModelMapping | null;
			cheapestMapping: ProviderModelMapping | null;
			officialCost: number;
			gatewayCost: number;
		}>;
		officialTotal: number;
		gatewayTotal: number;
		savings: number;
		savingsPercent: string;
	};
}) {
	const [copied, setCopied] = useState(false);

	const { rowDetails, officialTotal, gatewayTotal, savings, savingsPercent } =
		calculations;

	const hasModels = rowDetails.some((r) => r.model !== null);

	const shareText = useMemo(() => {
		if (!hasModels) {
			return "";
		}
		const modelLines = rowDetails
			.filter((r) => r.model)
			.map(
				(r) =>
					`- ${r.model!.name ?? r.model!.id}: ${formatUsd(r.officialCost)} → ${formatUsd(r.gatewayCost)}`,
			);
		const parts = [
			"My LLM cost breakdown:",
			"",
			...modelLines,
			"",
			`Total: ${formatUsd(officialTotal)} → ${formatUsd(gatewayTotal)}`,
		];
		if (savings > 0) {
			parts.push(`Saving ${savingsPercent}% with @llmgateway`);
		}
		parts.push("", "Calculate yours:");
		return parts.join("\n");
	}, [
		hasModels,
		rowDetails,
		officialTotal,
		gatewayTotal,
		savings,
		savingsPercent,
	]);

	const pageUrl =
		typeof window !== "undefined"
			? `${window.location.origin}/token-cost-calculator`
			: "https://llmgateway.io/token-cost-calculator";

	const handleCopy = async () => {
		await navigator.clipboard.writeText(`${shareText}\n${pageUrl}`);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	const xShareUrl = `https://x.com/intent/tweet?url=${encodeURIComponent(pageUrl)}&text=${encodeURIComponent(shareText)}`;
	const linkedinShareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(pageUrl)}`;

	if (!hasModels) {
		return (
			<Card className="p-8 text-center border-border bg-card/50">
				<p className="text-muted-foreground">
					Select at least one model above to see your cost comparison.
				</p>
			</Card>
		);
	}

	return (
		<div className="space-y-4">
			<div className="grid gap-3 sm:grid-cols-3">
				<Card className="p-5 border-border bg-card/50">
					<p className="text-xs font-medium text-muted-foreground mb-1">
						Official Provider Pricing
					</p>
					<p className="text-2xl font-bold">{formatUsd(officialTotal)}</p>
					<p className="text-xs text-muted-foreground mt-1">
						direct from providers
					</p>
				</Card>

				<Card className="p-5 border-2 border-green-500/50 bg-green-500/5 shadow-sm shadow-green-500/10">
					<p className="text-xs font-medium text-green-600 dark:text-green-400 mb-1">
						LLM Gateway Pricing
					</p>
					<p className="text-2xl font-bold text-green-600 dark:text-green-400">
						{formatUsd(gatewayTotal)}
					</p>
					<p className="text-xs text-muted-foreground mt-1">
						cheapest provider per model, no markup
					</p>
				</Card>

				<Card className="p-5 border-2 border-blue-500/50 bg-blue-500/5 shadow-sm shadow-blue-500/10">
					<p className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-1">
						You Save
					</p>
					<p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
						{savings > 0 ? formatUsd(savings) : "$0"}
					</p>
					<p className="text-xs text-muted-foreground mt-1">
						{savings > 0
							? `${savingsPercent}% less`
							: "same price, more features"}
					</p>
				</Card>
			</div>

			<div className="flex flex-col gap-4 rounded-xl border border-blue-500/30 bg-gradient-to-br from-blue-500/10 to-blue-600/5 p-5 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex items-start gap-3">
					<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/15 text-blue-600 dark:text-blue-400">
						<Share2 className="h-4 w-4" />
					</div>
					<div>
						<p className="text-sm font-semibold">
							{savings > 0
								? `Share your ${savingsPercent}% savings`
								: "Share these results"}
						</p>
						<p className="text-xs text-muted-foreground">
							Send this breakdown to your team or post it in one click.
						</p>
					</div>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Button
						onClick={handleCopy}
						variant={copied ? "outline" : "default"}
						size="sm"
						className="gap-2"
					>
						{copied ? (
							<Check className="h-4 w-4 text-green-500" />
						) : (
							<Copy className="h-4 w-4" />
						)}
						{copied ? "Copied!" : "Copy link"}
					</Button>
					<Button variant="outline" size="sm" className="gap-2" asChild>
						<a href={xShareUrl} target="_blank" rel="noopener noreferrer">
							<XIcon className="h-4 w-4" />
							Post on X
						</a>
					</Button>
					<Button variant="outline" size="sm" className="gap-2" asChild>
						<a
							href={linkedinShareUrl}
							target="_blank"
							rel="noopener noreferrer"
						>
							<Linkedin className="h-4 w-4" />
							LinkedIn
						</a>
					</Button>
				</div>
			</div>

			<Card className="border-border overflow-hidden">
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-border bg-muted/50">
								<th className="text-left py-3 px-4 font-medium text-muted-foreground">
									Model
								</th>
								<th className="text-right py-3 px-4 font-medium text-muted-foreground">
									Tokens
								</th>
								<th className="text-right py-3 px-4 font-medium text-muted-foreground">
									Official
								</th>
								<th className="text-right py-3 px-4 font-medium text-muted-foreground">
									LLM Gateway
								</th>
								<th className="text-right py-3 px-4 font-medium text-muted-foreground">
									Saved
								</th>
							</tr>
						</thead>
						<tbody>
							{rowDetails
								.filter((r) => r.model)
								.map((r) => {
									const rowSavings = r.officialCost - r.gatewayCost;
									return (
										<tr
											key={r.row.id}
											className="border-b border-border last:border-0"
										>
											<td className="py-3 px-4">
												<p className="font-medium">
													{r.model!.name ?? r.model!.id}
												</p>
												<p className="text-xs text-muted-foreground">
													{r.cheapestMapping
														? `via ${getProviderName(r.cheapestMapping.providerId)}`
														: ""}
												</p>
											</td>
											<td className="py-3 px-4 text-right font-mono text-xs text-muted-foreground">
												<span>{formatTokenCount(r.row.inputTokens)} in</span>
												<br />
												<span>{formatTokenCount(r.row.outputTokens)} out</span>
											</td>
											<td className="py-3 px-4 text-right font-mono">
												{formatUsd(r.officialCost)}
											</td>
											<td className="py-3 px-4 text-right font-mono text-green-600 dark:text-green-400">
												{formatUsd(r.gatewayCost)}
											</td>
											<td className="py-3 px-4 text-right font-mono">
												{rowSavings > 0 ? (
													<span className="text-blue-600 dark:text-blue-400">
														{formatUsd(rowSavings)}
													</span>
												) : (
													<span className="text-muted-foreground">—</span>
												)}
											</td>
										</tr>
									);
								})}
						</tbody>
						<tfoot>
							<tr className="bg-muted/30 font-medium">
								<td className="py-3 px-4" colSpan={2}>
									Total
								</td>
								<td className="py-3 px-4 text-right font-mono">
									{formatUsd(officialTotal)}
								</td>
								<td className="py-3 px-4 text-right font-mono text-green-600 dark:text-green-400">
									{formatUsd(gatewayTotal)}
								</td>
								<td className="py-3 px-4 text-right font-mono text-blue-600 dark:text-blue-400">
									{savings > 0 ? formatUsd(savings) : "—"}
								</td>
							</tr>
						</tfoot>
					</table>
				</div>
			</Card>

			{savings > 0 && (
				<Card className="border-2 border-green-500/30 bg-gradient-to-br from-green-500/10 to-green-600/5 p-8 text-center">
					<p className="text-sm text-muted-foreground mb-2">
						At official rates you&apos;re overpaying by
					</p>
					<p className="text-5xl sm:text-6xl font-bold text-green-600 dark:text-green-400 tracking-tight">
						{formatUsd(savings)}
					</p>
					<p className="text-lg text-green-600/80 dark:text-green-400/80 mt-2 font-medium">
						{savingsPercent}% less with LLM Gateway, same models
					</p>
					<p className="text-sm text-muted-foreground mt-4">
						Based on the token volumes entered above
					</p>
					<Button size="lg" className="mt-6" asChild>
						<Link href="/signup">
							Start saving for free
							<ArrowRight className="ml-2 h-4 w-4" />
						</Link>
					</Button>
				</Card>
			)}

			<div className="grid gap-3 sm:grid-cols-3">
				<div className="flex items-start gap-3 p-4 rounded-xl border border-border bg-card/50">
					<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
						<svg
							className="h-4 w-4 text-blue-500"
							fill="none"
							viewBox="0 0 24 24"
							strokeWidth={2}
							stroke="currentColor"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"
							/>
						</svg>
					</div>
					<div>
						<p className="text-sm font-medium">Smart Routing</p>
						<p className="text-xs text-muted-foreground mt-0.5">
							Automatically routes to the cheapest available provider for each
							model
						</p>
					</div>
				</div>
				<div className="flex items-start gap-3 p-4 rounded-xl border border-border bg-card/50">
					<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
						<svg
							className="h-4 w-4 text-blue-500"
							fill="none"
							viewBox="0 0 24 24"
							strokeWidth={2}
							stroke="currentColor"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
							/>
						</svg>
					</div>
					<div>
						<p className="text-sm font-medium">No Markup</p>
						<p className="text-xs text-muted-foreground mt-0.5">
							Zero platform fees — you pay exactly what the provider charges
						</p>
					</div>
				</div>
				<div className="flex items-start gap-3 p-4 rounded-xl border border-border bg-card/50">
					<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
						<svg
							className="h-4 w-4 text-blue-500"
							fill="none"
							viewBox="0 0 24 24"
							strokeWidth={2}
							stroke="currentColor"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182"
							/>
						</svg>
					</div>
					<div>
						<p className="text-sm font-medium">Automatic Failover</p>
						<p className="text-xs text-muted-foreground mt-0.5">
							If one provider is down, requests automatically route to the next
							cheapest
						</p>
					</div>
				</div>
			</div>
		</div>
	);
}
