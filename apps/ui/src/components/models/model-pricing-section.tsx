import Link from "next/link";

import { ModelCostCalculator } from "@/components/models/model-cost-calculator";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/lib/components/table";
import {
	comparisonPath,
	featuredComparisonsForModel,
	formatUsd,
	workloadCost,
} from "@/lib/model-comparisons";

import { formatNumber } from "@llmgateway/shared/number-format";

import type { Route } from "next";

export interface ModelPricingRow {
	key: string;
	label: string;
	inputPrice: number;
	outputPrice: number;
	cachedInputPrice: number | null;
	contextSize: number;
}

const WORKLOADS = [
	{ label: "1M input + 250K output tokens", input: 1e6, output: 2.5e5 },
	{ label: "10M input + 2.5M output tokens", input: 1e7, output: 2.5e6 },
	{ label: "100M input + 25M output tokens", input: 1e8, output: 2.5e7 },
];

export function ModelPricingSection({
	modelId,
	modelName,
	rows,
	tiered,
}: {
	modelId: string;
	modelName: string;
	rows: ModelPricingRow[];
	tiered: boolean;
}) {
	const cheapest = rows[0];
	if (!cheapest) {
		return null;
	}
	const comparisons = featuredComparisonsForModel(modelId);
	const cachedPrices = rows
		.map((row) => row.cachedInputPrice)
		.filter((price): price is number => price !== null);
	const isFree = rows.every(
		(row) => row.inputPrice === 0 && row.outputPrice === 0,
	);

	return (
		<div>
			<h2 className="text-xl font-semibold md:text-2xl">
				{modelName} API pricing
			</h2>
			<p className="mb-4 mt-1 max-w-3xl text-muted-foreground">
				{isFree
					? `${modelName} is free to use through LLM Gateway.`
					: `${modelName} API pricing starts at ${formatUsd(cheapest.inputPrice)} per 1M input tokens and ${formatUsd(cheapest.outputPrice)} per 1M output tokens through LLM Gateway${
							rows.length > 1 ? `, on ${cheapest.label}` : ""
						}.${
							cachedPrices.length > 0
								? ` Cached input starts at ${formatUsd(Math.min(...cachedPrices))} per 1M tokens.`
								: ""
						}`}
				{tiered
					? " Some providers charge more above a prompt-size threshold; the provider table lists every tier."
					: ""}
			</p>
			<div className="overflow-x-auto rounded-lg border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead scope="col">Provider</TableHead>
							<TableHead scope="col">Input / 1M tokens</TableHead>
							<TableHead scope="col">Output / 1M tokens</TableHead>
							<TableHead scope="col">Cached input / 1M tokens</TableHead>
							<TableHead scope="col">Context window</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{rows.map((row) => (
							<TableRow key={row.key}>
								<TableHead scope="row" className="font-medium">
									{row.label}
								</TableHead>
								<TableCell className="tabular-nums">
									{formatUsd(row.inputPrice)}
								</TableCell>
								<TableCell className="tabular-nums">
									{formatUsd(row.outputPrice)}
								</TableCell>
								<TableCell className="tabular-nums">
									{row.cachedInputPrice === null
										? "—"
										: formatUsd(row.cachedInputPrice)}
								</TableCell>
								<TableCell className="tabular-nums">
									{row.contextSize > 0
										? `${formatNumber(row.contextSize)} tokens`
										: "—"}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>

			{!isFree && (
				<>
					<h3 className="mb-3 mt-8 font-semibold">
						What {modelName} costs at volume
					</h3>
					<div className="overflow-x-auto rounded-lg border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead scope="col">Monthly usage</TableHead>
									<TableHead scope="col">Cost on {cheapest.label}</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{WORKLOADS.map((workload) => (
									<TableRow key={workload.label}>
										<TableHead scope="row" className="font-medium">
											{workload.label}
										</TableHead>
										<TableCell className="tabular-nums">
											{formatUsd(
												workloadCost(cheapest, workload.input, workload.output),
											)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
					<div className="mt-8">
						<ModelCostCalculator
							modelName={modelName}
							providers={rows.map((row) => ({
								key: row.key,
								label: row.label,
								inputPrice: row.inputPrice,
								outputPrice: row.outputPrice,
							}))}
						/>
					</div>
				</>
			)}

			{comparisons.length > 0 && (
				<>
					<h3 className="mb-3 mt-8 font-semibold">
						Compare {modelName} pricing with other models
					</h3>
					<ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
						{comparisons.map((comparison) => (
							<li key={comparison.slug}>
								<Link
									href={comparisonPath(comparison.slug) as Route}
									className="block rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted/50"
								>
									{modelName} vs {comparison.other.name}
								</Link>
							</li>
						))}
					</ul>
				</>
			)}
		</div>
	);
}
