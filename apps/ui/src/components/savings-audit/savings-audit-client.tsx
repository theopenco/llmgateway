"use client";

import { FileUp, Lock } from "lucide-react";
import Link from "next/link";
import Papa from "papaparse";
import { useId, useRef, useState } from "react";

import { AuthLink } from "@/components/shared/auth-link";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { Label } from "@/lib/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/lib/components/table";
import { cn } from "@/lib/utils";

import { formatCompactNumber } from "@llmgateway/shared/number-format";

import {
	COLUMN_ROLES,
	PLATFORM_FEE_RATE,
	REQUIRED_ROLES,
	ROLE_LABELS,
	UsageAggregator,
	detectColumns,
	formatAuditUsd,
	missingRoles,
	sampleCsv,
	type AuditResult,
	type ColumnMapping,
	type ColumnRole,
} from "./audit";

type Source = File | string;

const NO_COLUMN = "__none__";
const MAX_UNMATCHED_SHOWN = 12;

interface Loaded {
	source: Source;
	name: string;
	headers: string[];
	mapping: ColumnMapping;
}

function readHeaders(source: Source): Promise<string[]> {
	return new Promise((resolve, reject) => {
		Papa.parse<Record<string, unknown>>(source, {
			header: true,
			preview: 1,
			skipEmptyLines: true,
			complete: (results) => resolve(results.meta.fields ?? []),
			error: (error: Error) => reject(error),
		});
	});
}

function runAudit(
	source: Source,
	mapping: ColumnMapping,
): Promise<AuditResult> {
	return new Promise((resolve, reject) => {
		const aggregator = new UsageAggregator(mapping);
		Papa.parse<Record<string, unknown>>(source, {
			header: true,
			skipEmptyLines: true,
			step: (row) => aggregator.add(row.data),
			complete: () => resolve(aggregator.result()),
			error: (error: Error) => reject(error),
		});
	});
}

export function SavingsAuditClient() {
	const inputId = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	const [loaded, setLoaded] = useState<Loaded | null>(null);
	const [result, setResult] = useState<AuditResult | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [dragging, setDragging] = useState(false);

	const audit = async (next: Loaded) => {
		setLoaded(next);
		setResult(null);
		if (missingRoles(next.mapping).length > 0) {
			return;
		}
		setResult(await runAudit(next.source, next.mapping));
	};

	const load = async (source: Source, name: string) => {
		setBusy(true);
		setError(null);
		try {
			const headers = await readHeaders(source);
			if (headers.length === 0) {
				setLoaded(null);
				setResult(null);
				setError(
					"That file has no header row. Export it as CSV and try again.",
				);
				return;
			}
			await audit({ source, name, headers, mapping: detectColumns(headers) });
		} catch (cause) {
			setLoaded(null);
			setResult(null);
			setError(
				cause instanceof Error
					? `Could not read the file: ${cause.message}`
					: "Could not read the file.",
			);
		} finally {
			setBusy(false);
		}
	};

	const setColumn = async (role: ColumnRole, column: string) => {
		if (!loaded) {
			return;
		}
		const mapping: ColumnMapping = {
			...loaded.mapping,
			[role]: column === NO_COLUMN ? undefined : column,
		};
		setBusy(true);
		try {
			await audit({ ...loaded, mapping });
		} finally {
			setBusy(false);
		}
	};

	const missing = loaded ? missingRoles(loaded.mapping) : [];
	const feePercent = PLATFORM_FEE_RATE.mul(100).toNumber();

	return (
		<section className="pt-28 pb-16 md:pt-36">
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				<div className="mx-auto max-w-3xl text-center">
					<p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
						Free tool
					</p>
					<h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl">
						LLM savings audit
					</h1>
					<p className="mt-4 text-muted-foreground md:text-lg">
						Drop in a usage export from OpenRouter, OpenAI or any other
						platform. See what the same tokens cost on LLM Gateway, model by
						model.
					</p>
				</div>

				<div className="mx-auto mt-10 max-w-5xl space-y-6">
					<Card>
						<CardContent className="pt-6">
							<label
								htmlFor={inputId}
								onDragOver={(event) => {
									event.preventDefault();
									setDragging(true);
								}}
								onDragLeave={() => setDragging(false)}
								onDrop={(event) => {
									event.preventDefault();
									setDragging(false);
									const file = event.dataTransfer.files[0];
									if (file) {
										void load(file, file.name);
									}
								}}
								className={cn(
									"flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition-colors focus-within:border-primary",
									dragging ? "border-primary bg-primary/5" : "border-border",
								)}
							>
								<FileUp
									className="size-8 text-muted-foreground"
									aria-hidden="true"
								/>
								<span className="font-medium">
									{loaded
										? loaded.name
										: "Drop a usage CSV here, or choose a file"}
								</span>
								<span className="text-sm text-muted-foreground">
									Needs a model column and input and output token counts. A cost
									column is optional.
								</span>
								<input
									ref={inputRef}
									id={inputId}
									type="file"
									accept=".csv,text/csv"
									className="sr-only"
									onChange={(event) => {
										const file = event.target.files?.[0];
										if (file) {
											void load(file, file.name);
										}
										event.target.value = "";
									}}
								/>
							</label>
							<div className="mt-4 flex flex-wrap items-center justify-between gap-3">
								<p className="flex items-center gap-2 text-sm text-muted-foreground">
									<Lock className="size-4 shrink-0" aria-hidden="true" />
									The file is read in your browser and never uploaded.
								</p>
								<Button
									type="button"
									variant="outline"
									disabled={busy}
									onClick={() => load(sampleCsv(), "sample-usage.csv")}
								>
									Try sample data
								</Button>
							</div>
							{error ? (
								<p role="alert" className="mt-4 text-sm text-destructive">
									{error}
								</p>
							) : null}
						</CardContent>
					</Card>

					{loaded ? (
						<Card>
							<CardHeader>
								<CardTitle>Columns</CardTitle>
								<CardDescription>
									Detected from the header row. Change any that look wrong.
								</CardDescription>
							</CardHeader>
							<CardContent>
								<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
									{COLUMN_ROLES.map((role) => (
										<ColumnSelect
											key={role}
											role={role}
											headers={loaded.headers}
											value={loaded.mapping[role]}
											disabled={busy}
											onChange={(column) => setColumn(role, column)}
										/>
									))}
								</div>
								{missing.length > 0 ? (
									<p role="alert" className="mt-4 text-sm text-destructive">
										Choose a column for:{" "}
										{missing.map((role) => ROLE_LABELS[role]).join(", ")}.
									</p>
								) : null}
							</CardContent>
						</Card>
					) : null}

					<div aria-live="polite">
						{result ? (
							<AuditResults result={result} feePercent={feePercent} />
						) : null}
					</div>
				</div>
			</div>
		</section>
	);
}

function ColumnSelect({
	role,
	headers,
	value,
	disabled,
	onChange,
}: {
	role: ColumnRole;
	headers: string[];
	value: string | undefined;
	disabled: boolean;
	onChange: (column: string) => void;
}) {
	const id = useId();
	const required = REQUIRED_ROLES.includes(role);
	return (
		<div className="space-y-2">
			<Label htmlFor={id}>
				{ROLE_LABELS[role]}
				{required ? null : (
					<span className="font-normal text-muted-foreground"> (optional)</span>
				)}
			</Label>
			<Select
				value={value ?? NO_COLUMN}
				onValueChange={onChange}
				disabled={disabled}
			>
				<SelectTrigger id={id} className="w-full">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value={NO_COLUMN}>Not in this file</SelectItem>
					{headers.map((header) => (
						<SelectItem key={header} value={header}>
							{header}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

function AuditResults({
	result,
	feePercent,
}: {
	result: AuditResult;
	feePercent: number;
}) {
	const { totals } = result;
	if (result.comparedRows === 0) {
		return (
			<Card>
				<CardContent className="pt-6">
					<p className="font-medium">No model in this file could be priced.</p>
					<p className="mt-1 text-sm text-muted-foreground">
						Check that the model column holds model names, or browse the{" "}
						<Link href="/models" className="underline underline-offset-4">
							model catalogue
						</Link>{" "}
						for the ones you use.
					</p>
				</CardContent>
			</Card>
		);
	}

	const saves = totals.difference.gt(0);
	const baselineLabel =
		result.baselineSource === "file" ? "You paid" : "At list price";
	const percent = totals.differencePercent?.abs().toFixed(1);

	return (
		<div className="space-y-6">
			<div className="grid gap-4 md:grid-cols-3">
				<Card>
					<CardHeader>
						<CardDescription>{baselineLabel}</CardDescription>
						<CardTitle className="text-3xl tabular-nums">
							{formatAuditUsd(totals.baseline)}
						</CardTitle>
					</CardHeader>
					<CardContent className="text-sm text-muted-foreground">
						{result.baselineSource === "file"
							? "Summed from the cost column of your file."
							: "Your file has no cost column, so each model is priced at its own lab's list price."}
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardDescription>On LLM Gateway</CardDescription>
						<CardTitle className="text-3xl tabular-nums">
							{formatAuditUsd(totals.gateway)}
						</CardTitle>
					</CardHeader>
					<CardContent className="text-sm text-muted-foreground">
						{formatAuditUsd(totals.gatewayUsage)} at the cheapest live provider
						per model, plus the {feePercent}% platform fee on credits (
						{formatAuditUsd(totals.platformFee)}).
					</CardContent>
				</Card>
				<Card className={cn(saves && "border-green-600/50")}>
					<CardHeader>
						<CardDescription>
							{saves ? "You would save" : "Difference"}
						</CardDescription>
						<CardTitle
							className={cn(
								"text-3xl tabular-nums",
								saves && "text-green-600 dark:text-green-400",
							)}
						>
							{formatAuditUsd(totals.difference.abs())}
							{percent ? (
								<span className="ml-2 text-base font-medium">
									{saves ? "" : "+"}
									{percent}%
								</span>
							) : null}
						</CardTitle>
					</CardHeader>
					<CardContent className="text-sm text-muted-foreground">
						{saves
							? "From provider prices alone, before caching or routing discounts."
							: "On price alone this usage would not be cheaper here. Failover, one invoice and usage analytics are the reasons to switch."}
					</CardContent>
				</Card>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>By model</CardTitle>
					<CardDescription>
						{formatCompactNumber(result.comparedRows)} rows compared.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Model in file</TableHead>
								<TableHead>Cheapest provider</TableHead>
								<TableHead className="text-right">Tokens in / out</TableHead>
								<TableHead className="text-right">{baselineLabel}</TableHead>
								<TableHead className="text-right">On LLM Gateway</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{result.rows
								.filter((row) => row.gateway !== null && row.baseline !== null)
								.map((row) => (
									<TableRow key={row.sourceModel}>
										<TableCell>
											{row.modelId ? (
												<Link
													href={`/models/${encodeURIComponent(row.modelId)}`}
													className="font-medium hover:underline underline-offset-4"
												>
													{row.modelName}
												</Link>
											) : null}
											<span className="block text-xs text-muted-foreground">
												{row.sourceModel}
											</span>
										</TableCell>
										<TableCell>{row.providerName}</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatCompactNumber(row.inputTokens)} /{" "}
											{formatCompactNumber(row.outputTokens)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{row.baseline ? formatAuditUsd(row.baseline) : null}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{row.gateway ? formatAuditUsd(row.gateway) : null}
										</TableCell>
									</TableRow>
								))}
						</TableBody>
					</Table>
					{result.unmatched.length > 0 ? (
						<p className="mt-4 text-sm text-muted-foreground">
							Left out of both totals because no priced match was found:{" "}
							{result.unmatched.slice(0, MAX_UNMATCHED_SHOWN).join(", ")}
							{result.unmatched.length > MAX_UNMATCHED_SHOWN
								? ` and ${result.unmatched.length - MAX_UNMATCHED_SHOWN} more`
								: ""}
							.
						</p>
					) : null}
				</CardContent>
			</Card>

			<div className="flex flex-wrap items-center justify-center gap-3">
				<Button asChild>
					<AuthLink href="/signup">Start for free</AuthLink>
				</Button>
				<Button asChild variant="outline">
					<Link href="/migration">Read the migration guides</Link>
				</Button>
			</div>
		</div>
	);
}
