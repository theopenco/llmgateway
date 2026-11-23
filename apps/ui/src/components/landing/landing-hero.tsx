import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { DashboardDemo } from "@/components/home/dashboard-demo";
import { TrackedLink } from "@/components/home/tracked-link";
import { HeroCta } from "@/components/landing/hero-cta";
import {
	LandingStats,
	LandingStatsView,
} from "@/components/landing/landing-stats";
import {
	experimentAssignmentScript,
	HOME_HERO_CTA_EXPERIMENT,
} from "@/lib/experiments";

import { MARKETING_STATS } from "@llmgateway/shared";

export function LandingHero() {
	return (
		<div className="overflow-hidden">
			<div
				aria-hidden
				className="z-2 absolute inset-0 pointer-events-none isolate opacity-50 contain-strict hidden lg:block"
			>
				<div className="w-140 h-320 -translate-y-[350px] absolute left-0 top-0 -rotate-45 rounded-full bg-[radial-gradient(68.54%_68.72%_at_55.02%_31.46%,hsla(0,0%,85%,.08)_0,hsla(0,0%,55%,.02)_50%,hsla(0,0%,45%,0)_80%)]" />
				<div className="h-320 absolute left-0 top-0 w-56 -rotate-45 rounded-full bg-[radial-gradient(50%_50%_at_50%_50%,hsla(0,0%,85%,.06)_0,hsla(0,0%,45%,.02)_80%,transparent_100%)] [translate:5%_-50%]" />
				<div className="h-320 -translate-y-[350px] absolute left-0 top-0 w-56 -rotate-45 bg-[radial-gradient(50%_50%_at_50%_50%,hsla(0,0%,85%,.04)_0,hsla(0,0%,45%,.02)_80%,transparent_100%)]" />
			</div>
			<section>
				<div className="relative pt-36">
					<div
						aria-hidden
						className="absolute inset-0 -z-10 size-full [background:radial-gradient(125%_125%_at_50%_100%,transparent_0%,var(--background)_75%)]"
					/>
					<div className="mx-auto max-w-7xl px-6">
						{/* Announcement badge - centered */}
						<div className="mb-10 lg:mb-12 flex justify-center">
							<div className="animate-hero-enter">
								<Link
									href="/blog/soc2-type-ii"
									className="hover:bg-background dark:hover:border-t-border bg-muted group flex w-fit items-center gap-4 rounded-full border p-1 pl-4 shadow-md shadow-black/5 transition-all duration-300 dark:border-t-white/5 dark:shadow-zinc-950"
								>
									<span className="text-foreground text-sm">
										LLM Gateway Is Now SOC 2 Type II Compliant
									</span>
									<span className="dark:border-background block h-4 w-0.5 border-l bg-white dark:bg-zinc-700" />

									<div className="bg-background group-hover:bg-muted size-6 overflow-hidden rounded-full duration-500">
										<div className="flex w-12 -translate-x-1/2 duration-500 ease-in-out group-hover:translate-x-0">
											<span className="flex size-6">
												<ArrowRight className="m-auto size-3" />
											</span>
											<span className="flex size-6">
												<ArrowRight className="m-auto size-3" />
											</span>
										</div>
									</div>
								</Link>
							</div>
						</div>

						{/* Centered hero content - optimized for conversion */}
						<div className="text-center max-w-4xl mx-auto">
							<div>
								<h1 className="text-balance text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-foreground">
									LLM Gateway — One API for {MARKETING_STATS.providers}{" "}
									providers, including OpenAI, Anthropic, and Google
								</h1>
								<p className="mt-4 md:mt-6 max-w-2xl mx-auto text-balance text-base md:text-lg text-muted-foreground">
									The open-source LLM API gateway. Stop juggling API keys and
									provider dashboards. Route requests across{" "}
									{MARKETING_STATS.models} models, track costs in real-time, and
									switch providers without changing your code.
								</p>
							</div>

							{/* Primary CTA, with the enterprise path right under it */}
							<div className="animate-hero-enter hero-enter-delay-1 mt-8 md:mt-10 flex flex-col items-center gap-6">
								{/* Primary CTA - ShimmerButton with glow */}
								<div className="relative">
									{/* Outer glow ring */}
									<div className="absolute -inset-3 bg-blue-500/30 rounded-full blur-xl animate-pulse" />
									<script
										// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
										dangerouslySetInnerHTML={{
											__html: experimentAssignmentScript(
												HOME_HERO_CTA_EXPERIMENT,
											),
										}}
									/>
									<HeroCta />
								</div>

								<TrackedLink
									href="/enterprise"
									location="home_hero"
									cta="production_pilot"
									className="group/pilot text-sm text-muted-foreground transition-colors hover:text-foreground"
								>
									Rolling out to a team?{" "}
									<span className="font-medium text-foreground underline-offset-4 group-hover/pilot:underline">
										Start a 30-Day Production Pilot →
									</span>
								</TrackedLink>
							</div>
						</div>
					</div>

					<div className="animate-hero-enter hero-enter-delay-3">
						<div className="mx-auto mt-8 max-w-7xl px-4 pb-16 sm:mt-12 sm:px-6 md:mt-20 md:pb-24">
							<Suspense fallback={<LandingStatsView totals={undefined} />}>
								<LandingStats />
							</Suspense>
							<div className="mt-10">
								<DashboardDemo />
							</div>
						</div>
					</div>
				</div>
			</section>
		</div>
	);
}
