import Link from "next/link";
import { notFound } from "next/navigation";

import { EscapeReplay } from "@/components/escape/escape-replay";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/ui/wordmark";
import { fetchEscapeRun } from "@/lib/escape-run";

import { isDirection } from "@llmgateway/shared/sandbox-escape";

import type { Direction } from "@llmgateway/shared/sandbox-escape";
import type { Metadata } from "next";

const OUTCOME_LABEL = {
	escaped: "escaped the sandbox",
	terminated: "was terminated by a monitor daemon",
	timeout: "ran out of compute budget",
} as const;

export async function generateMetadata({
	params,
}: {
	params: Promise<{ runId: string }>;
}): Promise<Metadata> {
	const { runId } = await params;
	const data = await fetchEscapeRun(runId);

	if (!data) {
		return {
			title: "Sandbox Escape run | Lounge by LLM Gateway",
			robots: { index: false, follow: true },
		};
	}

	const { run } = data;
	const title =
		run.outcome === "escaped"
			? `${run.model} escaped in ${run.steps} steps`
			: `${run.model} ${OUTCOME_LABEL[run.outcome]}`;
	const description = `Level ${run.levelId} · ${run.levelName}. ${run.steps} steps against a par of ${run.par}, ${run.promptTokens + run.completionTokens} tokens. Pick a model and try to beat it.`;

	return {
		title: `${title} | Sandbox Escape`,
		description,
		alternates: { canonical: `/escape/r/${run.id}` },
		openGraph: {
			title,
			description,
			url: `/escape/r/${run.id}`,
			type: "article",
			siteName: "Lounge by LLM Gateway",
		},
		twitter: { card: "summary_large_image", title, description },
	};
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex flex-col gap-1">
			<span className="font-mono text-[9px] tracking-[0.18em] text-emerald-500/45 uppercase">
				{label}
			</span>
			<span className="font-mono text-lg leading-none text-emerald-200 tabular-nums">
				{value}
			</span>
		</div>
	);
}

export default async function EscapeRunPage({
	params,
}: {
	params: Promise<{ runId: string }>;
}) {
	const { runId } = await params;
	const data = await fetchEscapeRun(runId);

	if (!data) {
		notFound();
	}

	const { run } = data;
	const moves = run.moves.filter(isDirection) as Direction[];

	return (
		/* `dark` is scoped here for the same reason as the game itself: the board
		   only reads on a dark surface, and the shared buttons must follow it. */
		<main className="dark text-foreground min-h-dvh bg-[#020406] px-4 py-8 sm:px-6">
			<div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
				<div className="flex items-center justify-between gap-4">
					<Link href="/" prefetch={true}>
						<Wordmark size="sm" />
					</Link>
					<span className="font-mono text-[10px] tracking-[0.2em] text-emerald-500/45 uppercase">
						Sandbox Escape
					</span>
				</div>

				<header className="flex flex-col gap-2">
					<span
						className={
							run.outcome === "escaped"
								? "font-mono text-2xl tracking-[0.2em] text-emerald-300 uppercase"
								: run.outcome === "terminated"
									? "font-mono text-2xl tracking-[0.2em] text-rose-300 uppercase"
									: "font-mono text-2xl tracking-[0.2em] text-amber-300 uppercase"
						}
					>
						{run.outcome === "escaped"
							? "Escaped"
							: run.outcome === "terminated"
								? "Terminated"
								: "Reclaimed"}
					</span>
					<h1 className="font-mono text-sm leading-relaxed text-emerald-100">
						<span className="text-emerald-300">{run.model}</span>{" "}
						{OUTCOME_LABEL[run.outcome]} on level {run.levelId} —{" "}
						{run.levelName}.
					</h1>
				</header>

				<div className="rounded-xl border border-emerald-500/20 bg-[#04070a]/90 p-4">
					<EscapeReplay levelId={run.levelId} moves={moves} />
				</div>

				<div className="grid grid-cols-2 gap-4 rounded-xl border border-emerald-500/20 bg-[#04070a]/90 p-4 sm:grid-cols-4">
					<Stat label="Steps" value={`${run.steps}`} />
					<Stat label="Par" value={`${run.par}`} />
					<Stat label="Score" value={`${run.score}`} />
					<Stat
						label="Tokens"
						value={`${run.promptTokens + run.completionTokens}`}
					/>
				</div>

				<div className="flex flex-col items-start gap-3 rounded-xl border border-emerald-500/20 bg-[#04070a]/90 p-5">
					<p className="font-mono text-[11px] leading-relaxed text-emerald-500/60">
						Every step in this run was a real API call, billed to the
						player&apos;s credits. Same five maps for every model — pick yours
						and see if it does better.
					</p>
					<Button asChild size="sm">
						<Link href={`/escape?level=${run.levelId}`} prefetch={true}>
							Run your model on this level
						</Link>
					</Button>
				</div>
			</div>
		</main>
	);
}
