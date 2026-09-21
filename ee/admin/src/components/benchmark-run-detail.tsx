"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { formatDuration } from "@/components/benchmark-runs-table";
import { Badge } from "@/components/ui/badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	formatNumber,
	formatPercent,
	formatUsd,
	parseBenchmarkTargets,
} from "@/lib/benchmark-result";

import type {
	BenchmarkRunDetailResponse,
	BenchmarkRunSummary,
} from "@/lib/types";

export function BenchmarkRunDetail({
	run,
	targets,
	result,
}: {
	run: BenchmarkRunSummary;
	targets: BenchmarkRunDetailResponse["targets"];
	result: Record<string, unknown> | null;
}) {
	const views = parseBenchmarkTargets(result);
	const agentViews = views.filter((view) => view.agent !== null);
	// The coding profile has neither quality nor performance cases, so its
	// summary row would be a line of dashes.
	const hasSummaryMetrics = views.some(
		(view) =>
			view.qualityAttempted > 0 ||
			view.ttftP50 !== null ||
			view.totalP50 !== null,
	);
	const totalCost = views.reduce(
		(sum, view) => sum + (view.totalCostUsd ?? 0),
		0,
	);

	return (
		<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
			<header className="flex flex-col gap-2">
				<Link
					href="/benchmarks"
					prefetch={true}
					className="flex items-center gap-1 text-sm text-muted-foreground hover:underline"
				>
					<ArrowLeft className="h-3 w-3" />
					Benchmarks
				</Link>
				<div className="flex flex-wrap items-center gap-3">
					<h1 className="text-3xl font-semibold tracking-tight">
						{run.modelId}
					</h1>
					<Badge
						variant={run.status === "failed" ? "destructive" : "secondary"}
					>
						{run.status}
					</Badge>
				</div>
				<p className="text-sm text-muted-foreground">
					Profile <span className="font-medium">{run.profile}</span> ·{" "}
					{targets.length} target{targets.length === 1 ? "" : "s"} ·{" "}
					{Math.round(run.budgetMs / 1000)}s budget per target · seed {run.seed}{" "}
					· {formatDuration(run.startedAt, run.completedAt)} ·{" "}
					{formatUsd(totalCost || null)} spent
				</p>
				{run.error ? (
					<p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
						{run.error}
					</p>
				) : null}
			</header>

			{views.length > 0 && !hasSummaryMetrics ? null : views.length === 0 ? (
				<p className="rounded-md border px-4 py-8 text-center text-sm text-muted-foreground">
					{run.status === "completed"
						? "This run produced no measurable results."
						: "Results appear once the worker finishes this run."}
				</p>
			) : (
				<section className="space-y-2">
					<h2 className="text-lg font-semibold">Summary</h2>
					<div className="rounded-md border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Target</TableHead>
									<TableHead className="text-right">Success</TableHead>
									<TableHead className="text-right">Quality</TableHead>
									<TableHead className="text-right">Score</TableHead>
									<TableHead className="text-right">TTFT p50 (ms)</TableHead>
									<TableHead className="text-right">Total p50 (ms)</TableHead>
									<TableHead className="text-right">Visible tok/s</TableHead>
									<TableHead className="text-right">Cost/correct</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{views.map((view) => (
									<TableRow key={view.targetId}>
										<TableCell className="font-medium">
											{view.displayName}
										</TableCell>
										<TableCell className="text-right">
											{formatPercent(view.successRate)}
										</TableCell>
										<TableCell className="text-right">
											{view.qualityPassed}/{view.qualityAttempted}
										</TableCell>
										<TableCell className="text-right">
											{formatPercent(view.qualityScore)}
										</TableCell>
										<TableCell className="text-right">
											{formatNumber(view.ttftP50)}
										</TableCell>
										<TableCell className="text-right">
											{formatNumber(view.totalP50)}
										</TableCell>
										<TableCell className="text-right">
											{formatNumber(view.tokensPerSecondP50)}
										</TableCell>
										<TableCell className="text-right">
											{formatUsd(view.costPerCorrectUsd)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				</section>
			)}

			{agentViews.length > 0 ? (
				<section className="space-y-2">
					<h2 className="text-lg font-semibold">Agentic coding</h2>
					<div className="rounded-md border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Target</TableHead>
									<TableHead className="text-right">Solved</TableHead>
									<TableHead className="text-right">Solve rate</TableHead>
									<TableHead className="text-right">Turns p50</TableHead>
									<TableHead className="text-right">Tool calls p50</TableHead>
									<TableHead className="text-right">Invalid</TableHead>
									<TableHead className="text-right">Repeated</TableHead>
									<TableHead className="text-right">Wall clock p50</TableHead>
									<TableHead className="text-right">Cost/solved</TableHead>
									<TableHead>Stop reasons</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{agentViews.map((view) => (
									<TableRow key={view.targetId}>
										<TableCell className="font-medium">
											{view.displayName}
										</TableCell>
										<TableCell className="text-right">
											{view.agent!.solved}/{view.agent!.attempted}
										</TableCell>
										<TableCell className="text-right">
											{formatPercent(view.agent!.solveRate)}
										</TableCell>
										<TableCell className="text-right">
											{formatNumber(view.agent!.turnsP50)}
										</TableCell>
										<TableCell className="text-right">
											{formatNumber(view.agent!.toolCallsP50)}
										</TableCell>
										<TableCell className="text-right">
											{formatPercent(view.agent!.invalidToolCallRate)}
										</TableCell>
										<TableCell className="text-right">
											{formatPercent(view.agent!.repeatedToolCallRate)}
										</TableCell>
										<TableCell className="text-right">
											{formatNumber(view.agent!.wallClockP50, 0)}
										</TableCell>
										<TableCell className="text-right">
											{formatUsd(view.agent!.costPerSolvedTaskUsd)}
										</TableCell>
										<TableCell className="text-muted-foreground">
											{Object.entries(view.agent!.stopReasons)
												.map(([reason, count]) => `${reason}×${count}`)
												.join(", ") || "—"}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				</section>
			) : null}

			<section className="space-y-2">
				<h2 className="text-lg font-semibold">Targets</h2>
				<div className="rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Target</TableHead>
								<TableHead>Mapping</TableHead>
								<TableHead>Source</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{targets.map((target) => (
								<TableRow key={target.targetId}>
									<TableCell className="font-medium">
										{target.displayName}
									</TableCell>
									<TableCell>{target.mapping}</TableCell>
									<TableCell>
										<Badge
											variant={
												target.source === "airside" ? "secondary" : "outline"
											}
										>
											{target.source}
										</Badge>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			</section>
		</div>
	);
}
