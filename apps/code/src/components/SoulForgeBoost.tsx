import { ArrowRight, Sparkles } from "lucide-react";

import { SoulForgeIcon } from "@llmgateway/shared/components";

export function SoulForgeBoost() {
	return (
		<section className="relative overflow-hidden border-y bg-gradient-to-b from-background via-emerald-500/[0.04] to-background py-20 px-4">
			<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-emerald-500/[0.06] via-transparent to-transparent" />
			<div className="container relative mx-auto max-w-5xl">
				<div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
					<div>
						<div className="mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
							<Sparkles className="h-3 w-3" />
							Pair with SoulForge
						</div>
						<h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">
							Cut ~50% of tokens.
							<br />
							<span className="text-emerald-700 dark:text-emerald-400">
								Double the value of your DevPass.
							</span>
						</h2>
						<p className="mb-6 text-base leading-relaxed text-muted-foreground">
							SoulForge is a coding agent built around aggressive prompt caching
							and context reuse. Point it at LLM Gateway and it sends roughly
							half the tokens of an equivalent Claude Code session — same model,
							same task, smaller bill.
						</p>
						<ul className="mb-8 space-y-3">
							<li className="flex items-start gap-3 text-sm">
								<div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
									<span className="text-xs font-bold">1</span>
								</div>
								<span className="text-muted-foreground">
									<span className="font-medium text-foreground">
										Prompt caching by default
									</span>{" "}
									— system prompt, tools, and project context are cached on
									every provider that supports it.
								</span>
							</li>
							<li className="flex items-start gap-3 text-sm">
								<div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
									<span className="text-xs font-bold">2</span>
								</div>
								<span className="text-muted-foreground">
									<span className="font-medium text-foreground">
										Context-aware compaction
									</span>{" "}
									— SoulForge prunes stale turns instead of replaying the whole
									conversation.
								</span>
							</li>
							<li className="flex items-start gap-3 text-sm">
								<div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
									<span className="text-xs font-bold">3</span>
								</div>
								<span className="text-muted-foreground">
									<span className="font-medium text-foreground">
										Same DevPass key
									</span>{" "}
									— no separate subscription. Run{" "}
									<code className="font-mono text-foreground">soulforge</code>,
									type <code className="font-mono text-foreground">/keys</code>,
									paste your key.
								</span>
							</li>
						</ul>
						<a
							href="https://soulforge.proxysoul.com/"
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground hover:gap-2 transition-all"
						>
							Get SoulForge
							<ArrowRight className="h-4 w-4" />
						</a>
					</div>

					{/* Visualization: tokens used per task */}
					<div className="relative rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
						<div className="absolute -top-3 left-6 inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
							Tokens used · same task
						</div>
						<div className="space-y-5">
							{/* Baseline */}
							<div>
								<div className="mb-2 flex items-baseline justify-between">
									<span className="text-sm font-medium text-foreground">
										Without SoulForge
									</span>
									<span className="font-mono text-sm font-semibold tabular-nums">
										1,000K
									</span>
								</div>
								<div className="relative h-7 overflow-hidden rounded-md bg-muted">
									<div className="absolute inset-y-0 left-0 w-full bg-foreground/20" />
									<div className="absolute inset-0 bg-[repeating-linear-gradient(135deg,transparent_0,transparent_6px,rgba(0,0,0,0.04)_6px,rgba(0,0,0,0.04)_12px)] dark:bg-[repeating-linear-gradient(135deg,transparent_0,transparent_6px,rgba(255,255,255,0.04)_6px,rgba(255,255,255,0.04)_12px)]" />
								</div>
								<p className="mt-1.5 text-xs text-muted-foreground">
									Standard agent loop, no aggressive caching
								</p>
							</div>

							{/* SoulForge */}
							<div>
								<div className="mb-2 flex items-baseline justify-between">
									<div className="flex items-center gap-2">
										<SoulForgeIcon className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
										<span className="text-sm font-medium text-foreground">
											With SoulForge
										</span>
										<span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
											−50%
										</span>
									</div>
									<span className="font-mono text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
										~500K
									</span>
								</div>
								<div className="relative h-7 overflow-hidden rounded-md bg-muted">
									<div className="absolute inset-y-0 left-0 w-1/2 bg-emerald-500/70" />
								</div>
								<p className="mt-1.5 text-xs text-muted-foreground">
									Prompt-cache hits on every reusable prefix
								</p>
							</div>

							<div className="border-t pt-4">
								<div className="flex items-center justify-between">
									<span className="text-xs uppercase tracking-wider text-muted-foreground">
										Effective DevPass value
									</span>
								</div>
								<div className="mt-2 grid grid-cols-3 gap-3 text-center">
									<div className="rounded-lg border bg-background p-3">
										<div className="font-mono text-xl font-bold tabular-nums">
											3×
										</div>
										<div className="text-[10px] uppercase tracking-wider text-muted-foreground">
											Plan baseline
										</div>
									</div>
									<div className="flex items-center justify-center text-muted-foreground">
										<ArrowRight className="h-5 w-5" />
									</div>
									<div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
										<div className="font-mono text-xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
											~6×
										</div>
										<div className="text-[10px] uppercase tracking-wider text-emerald-700/80 dark:text-emerald-300/80">
											With SoulForge
										</div>
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
				<p className="mt-8 text-center text-xs text-muted-foreground">
					Actual savings vary by workload. The 50% figure is typical for
					multi-turn agent sessions where the system prompt and codebase context
					stay stable.
				</p>
			</div>
		</section>
	);
}
