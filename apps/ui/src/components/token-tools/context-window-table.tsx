"use client";

import Link from "next/link";

import { countTokens } from "@/components/token-cost-calculator/tokenizer";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/lib/components/table";

import { formatNumber } from "@llmgateway/shared/number-format";

import type { Route } from "next";

export interface ContextWindowModel {
	id: string;
	name: string;
	contextSize: number;
	maxOutput: number;
}

const MAX_ROWS = 100;

type Fit = "yes" | "no" | "unknown";

const FIT_LABELS: Record<Fit, string> = {
	yes: "Yes",
	no: "No",
	unknown: "Unknown output limit",
};

// A model with no recorded output limit may still have one, so a request that
// reserves output cannot be confirmed to fit.
function fitFor(
	model: ContextWindowModel,
	needed: number,
	outputTokens: number,
): Fit {
	if (needed > model.contextSize) {
		return "no";
	}
	if (model.maxOutput === 0) {
		return outputTokens > 0 ? "unknown" : "yes";
	}
	return outputTokens <= model.maxOutput ? "yes" : "no";
}

export function ContextWindowTable({
	models,
	text,
	manualTokens,
	outputTokens,
	query,
}: {
	models: ContextWindowModel[];
	text: string;
	manualTokens: number;
	outputTokens: number;
	query: string;
}) {
	const promptTokens = manualTokens > 0 ? manualTokens : countTokens(text);
	const needed = promptTokens + outputTokens;
	const normalizedQuery = query.trim().toLowerCase();
	const rows = models
		.filter(
			(model) =>
				!normalizedQuery ||
				model.name.toLowerCase().includes(normalizedQuery) ||
				model.id.toLowerCase().includes(normalizedQuery),
		)
		.map((model) => ({ ...model, fit: fitFor(model, needed, outputTokens) }));
	const fitting = rows.filter((row) => row.fit === "yes").length;
	const visible = rows.slice(0, MAX_ROWS);

	return (
		<div aria-live="polite">
			<p className="mb-3 text-sm text-muted-foreground">
				{formatNumber(promptTokens)} prompt tokens +{" "}
				{formatNumber(outputTokens)} output tokens = {formatNumber(needed)}{" "}
				tokens needed. {formatNumber(fitting)} of {formatNumber(rows.length)}{" "}
				models fit.
			</p>
			<div className="overflow-x-auto rounded-lg border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead scope="col">Model</TableHead>
							<TableHead scope="col">Context window</TableHead>
							<TableHead scope="col">Max output</TableHead>
							<TableHead scope="col">Window used</TableHead>
							<TableHead scope="col">Fits</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{visible.map((row) => (
							<TableRow key={row.id}>
								<TableHead scope="row" className="font-medium">
									<Link
										href={`/models/${encodeURIComponent(row.id)}` as Route}
										className="hover:underline"
									>
										{row.name}
									</Link>
								</TableHead>
								<TableCell className="tabular-nums">
									{formatNumber(row.contextSize)}
								</TableCell>
								<TableCell className="tabular-nums">
									{row.maxOutput > 0 ? formatNumber(row.maxOutput) : "—"}
								</TableCell>
								<TableCell className="tabular-nums">
									{Math.round((needed / row.contextSize) * 100)}%
								</TableCell>
								<TableCell
									className={
										row.fit === "yes"
											? "font-medium text-emerald-600 dark:text-emerald-400"
											: "text-muted-foreground"
									}
								>
									{FIT_LABELS[row.fit]}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
			{rows.length > MAX_ROWS && (
				<p className="mt-3 text-sm text-muted-foreground">
					Showing the {MAX_ROWS} largest context windows. Filter by name to see
					a specific model.
				</p>
			)}
		</div>
	);
}
