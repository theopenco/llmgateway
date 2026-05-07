"use client";

import { ArrowDown } from "lucide-react";
import { useInView } from "motion/react";
import { useRef } from "react";

import { NumberTicker } from "@/lib/components/number-ticker";

// Each provider has ~6% outage distributed across the year.
// Crucially, NO outage windows overlap between providers —
// this demonstrates that when one provider is down, others are up.
const providers = [
	{
		name: "Anthropic",
		outages: [
			[8, 10],
			[42, 44],
			[78, 80],
		] as [number, number][],
	},
	{
		name: "AWS Bedrock",
		outages: [
			[3, 5],
			[30, 32],
			[63, 65],
		] as [number, number][],
	},
	{
		name: "Google Vertex",
		outages: [
			[18, 20],
			[50, 52],
			[72, 74],
		] as [number, number][],
	},
	{
		name: "Azure OpenAI",
		outages: [
			[13, 15],
			[37, 39],
			[86, 88],
		] as [number, number][],
	},
	{
		name: "Fireworks AI",
		outages: [
			[23, 25],
			[55, 57],
			[95, 97],
		] as [number, number][],
	},
];

function buildSegments(
	outages: [number, number][],
): Array<{ type: "up" | "down"; width: number }> {
	const segments: Array<{ type: "up" | "down"; width: number }> = [];
	let pos = 0;

	for (const [start, end] of outages) {
		if (start > pos) {
			segments.push({ type: "up", width: start - pos });
		}
		segments.push({ type: "down", width: end - start });
		pos = end;
	}

	if (pos < 100) {
		segments.push({ type: "up", width: 100 - pos });
	}

	return segments;
}

export function UptimeVisualization() {
	const ref = useRef<HTMLDivElement>(null);
	const inView = useInView(ref, { once: true, margin: "-80px" });

	return (
		<section className="py-20 sm:py-28" ref={ref}>
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				<div className="mx-auto max-w-5xl">
					{/* Section header */}
					<div className="mb-12 text-center sm:mb-16">
						<div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-1.5">
							<span className="relative flex h-2 w-2">
								<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
								<span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
							</span>
							<span className="text-xs font-mono text-emerald-600 dark:text-emerald-400">
								RELIABILITY
							</span>
						</div>
						<h2 className="mb-4 text-3xl font-bold tracking-tight text-balance sm:text-4xl lg:text-5xl">
							Never go down.{" "}
							<span className="text-muted-foreground">
								Even when your providers do.
							</span>
						</h2>
						<p className="mx-auto max-w-3xl text-lg leading-relaxed text-muted-foreground text-balance">
							LLM Gateway automatically routes requests to healthy providers in
							real-time. When one goes down, your traffic seamlessly fails
							over—your users never notice.
						</p>
					</div>

					{/* Timeline visualization */}
					<div
						className="rounded-2xl border border-border bg-card p-4 sm:p-8"
						role="img"
						aria-label="Visualization showing individual provider uptime at 94% each, combining to 99.9999% through automatic failover"
					>
						<div className="space-y-2.5 sm:space-y-3">
							{providers.map((provider, index) => {
								const segments = buildSegments(provider.outages);
								const totalDown = provider.outages.reduce(
									(sum, [s, e]) => sum + (e - s),
									0,
								);

								return (
									<div
										key={provider.name}
										className="flex items-center gap-2 sm:gap-4"
									>
										<div className="w-20 shrink-0 text-right sm:w-28">
											<span className="text-xs font-medium text-muted-foreground sm:text-sm">
												{provider.name}
											</span>
										</div>
										<div className="relative h-5 flex-1 overflow-hidden rounded sm:h-7">
											<div className="absolute inset-0 bg-muted/40" />
											<div
												className="flex h-full"
												style={{
													clipPath: inView
														? "inset(0 0 0 0)"
														: "inset(0 100% 0 0)",
													transition:
														"clip-path 1.2s cubic-bezier(0.16, 1, 0.3, 1)",
													transitionDelay: `${index * 150}ms`,
												}}
											>
												{segments.map((seg, i) => (
													<div
														key={i}
														className={
															seg.type === "up"
																? "h-full bg-emerald-500/50 dark:bg-emerald-500/30"
																: "h-full bg-red-500/70 dark:bg-red-500/50"
														}
														style={{
															width: `${seg.width}%`,
														}}
													/>
												))}
											</div>
										</div>
										<div className="w-12 shrink-0 text-right sm:w-20">
											<span className="text-xs font-mono text-muted-foreground sm:text-sm">
												{100 - totalDown}%
											</span>
										</div>
									</div>
								);
							})}
						</div>

						{/* Routing indicator */}
						<div className="my-4 flex items-center gap-2 sm:my-6 sm:gap-4">
							<div className="w-20 shrink-0 sm:w-28" />
							<div className="relative flex-1 border-t border-dashed border-border">
								<div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 whitespace-nowrap bg-card px-3 py-0.5 text-xs font-mono text-muted-foreground">
									<ArrowDown className="h-3 w-3 text-blue-500" />
									Automatic failover
								</div>
							</div>
							<div className="w-12 shrink-0 sm:w-20" />
						</div>

						{/* Gateway combined bar — solid green */}
						<div className="flex items-center gap-2 sm:gap-4">
							<div className="w-20 shrink-0 text-right sm:w-28">
								<span className="text-xs font-bold text-foreground sm:text-sm">
									LLM Gateway
								</span>
							</div>
							<div className="relative h-5 flex-1 overflow-hidden rounded sm:h-7">
								<div className="absolute inset-0 bg-muted/40" />
								<div
									className="absolute inset-0 rounded bg-emerald-500"
									style={{
										clipPath: inView ? "inset(0 0 0 0)" : "inset(0 100% 0 0)",
										transition: "clip-path 1.4s cubic-bezier(0.16, 1, 0.3, 1)",
										transitionDelay: "900ms",
									}}
								/>
								<div
									className="pointer-events-none absolute inset-0 rounded"
									style={{
										boxShadow:
											"0 0 20px oklch(0.65 0.19 145 / 0.3), inset 0 1px 0 oklch(0.8 0.15 145 / 0.2)",
										opacity: inView ? 1 : 0,
										transition: "opacity 0.5s ease",
										transitionDelay: "2s",
									}}
								/>
							</div>
							<div className="w-12 shrink-0 text-right sm:w-20">
								<span className="text-xs font-mono font-bold text-emerald-600 sm:text-sm dark:text-emerald-400">
									99.9999%
								</span>
							</div>
						</div>
					</div>

					{/* Before / After comparison cards */}
					<div className="mt-8 grid gap-4 sm:mt-12 sm:grid-cols-2 sm:gap-6">
						{/* Without */}
						<div className="rounded-xl border border-red-500/20 bg-red-500/[0.03] p-5 sm:p-6">
							<div className="mb-3 text-xs font-mono tracking-wider text-red-500/70">
								WITHOUT LLM GATEWAY
							</div>
							<div className="font-mono text-3xl font-bold sm:text-4xl">
								94%
							</div>
							<div className="mt-1 text-sm text-muted-foreground">
								uptime per provider
							</div>
							<div className="mt-4 border-t border-red-500/10 pt-4">
								<div className="font-mono text-lg font-bold text-red-500 dark:text-red-400">
									~22 days
								</div>
								<div className="text-sm text-muted-foreground">
									of downtime per year
								</div>
							</div>
						</div>

						{/* With */}
						<div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.03] p-5 sm:p-6">
							<div className="mb-3 text-xs font-mono tracking-wider text-emerald-600/70 dark:text-emerald-400/70">
								WITH LLM GATEWAY
							</div>
							<div className="font-mono text-3xl font-bold text-emerald-600 sm:text-4xl dark:text-emerald-400">
								<NumberTicker
									value={99.9999}
									startValue={94}
									decimalPlaces={4}
									delay={1.5}
									className="!text-emerald-600 dark:!text-emerald-400"
								/>
								%
							</div>
							<div className="mt-1 text-sm text-muted-foreground">
								combined uptime across providers
							</div>
							<div className="mt-4 border-t border-emerald-500/10 pt-4">
								<div className="font-mono text-lg font-bold text-emerald-600 dark:text-emerald-400">
									&lt;32 seconds
								</div>
								<div className="text-sm text-muted-foreground">
									of downtime per year
								</div>
							</div>
						</div>
					</div>

					{/* Math explanation */}
					<p className="mx-auto mt-6 max-w-2xl text-center text-sm leading-relaxed text-muted-foreground">
						Each provider averages ~94% uptime independently. With automatic
						failover across multiple providers, the probability of simultaneous
						downtime drops to near zero—giving you effective uptime of 99.9999%.
					</p>
				</div>
			</div>
		</section>
	);
}
