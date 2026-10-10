"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

import type { BenchmarkRunSummary } from "@/lib/types";

const STATUS_VARIANT: Record<
	BenchmarkRunSummary["status"],
	"default" | "secondary" | "destructive" | "outline"
> = {
	queued: "outline",
	running: "secondary",
	completed: "default",
	failed: "destructive",
	canceled: "outline",
};

export function formatDuration(
	startedAt: string | null,
	completedAt: string | null,
): string {
	if (!startedAt) {
		return "—";
	}
	const end = completedAt ? new Date(completedAt) : new Date();
	const seconds = Math.max(
		0,
		Math.round((end.getTime() - new Date(startedAt).getTime()) / 1000),
	);
	return seconds < 60
		? `${seconds}s`
		: `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function BenchmarkRunsTable({ runs }: { runs: BenchmarkRunSummary[] }) {
	if (runs.length === 0) {
		return (
			<p className="rounded-md border px-4 py-8 text-center text-sm text-muted-foreground">
				No benchmark runs yet.
			</p>
		);
	}

	return (
		<div className="rounded-md border">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Model</TableHead>
						<TableHead>Profile</TableHead>
						<TableHead>Targets</TableHead>
						<TableHead>Status</TableHead>
						<TableHead>Duration</TableHead>
						<TableHead>Queued</TableHead>
						<TableHead>By</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{runs.map((run) => (
						<TableRow key={run.id}>
							<TableCell className="font-medium">
								<Link
									href={`/benchmarks/${run.id}`}
									className="hover:underline"
									prefetch={true}
								>
									{run.modelId}
								</Link>
								{run.mappings.length > 0 ? (
									<span className="ml-2 text-xs text-muted-foreground">
										{run.mappings.join(", ")}
									</span>
								) : null}
							</TableCell>
							<TableCell>{run.profile}</TableCell>
							<TableCell>{run.targetCount}</TableCell>
							<TableCell>
								<Badge variant={STATUS_VARIANT[run.status]}>{run.status}</Badge>
								{run.error ? (
									<span className="ml-2 text-xs text-destructive">
										{run.error.slice(0, 80)}
									</span>
								) : null}
							</TableCell>
							<TableCell>
								{formatDuration(run.startedAt, run.completedAt)}
							</TableCell>
							<TableCell className="text-muted-foreground">
								{new Date(run.createdAt).toLocaleString()}
							</TableCell>
							<TableCell className="text-muted-foreground">
								{run.requestedByEmail ?? "—"}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}
