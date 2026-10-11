import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { DashboardDemo } from "@/components/home/dashboard-demo";
import { AuthLink } from "@/components/shared/auth-link";
import { ShimmerButton } from "@/lib/components/shimmer-button";

import { MARKETING_STATS } from "@llmgateway/shared";

const STATS = [
	{ value: MARKETING_STATS.tokensRouted, label: "tokens routed" },
	{ value: MARKETING_STATS.requestsRouted, label: "requests routed" },
	{ value: MARKETING_STATS.models, label: "models" },
	{ value: MARKETING_STATS.providers, label: "providers" },
];

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
				{/* pt-36 (not pt-24) on mobile clears the Runware promo banner
						    stacked above the fixed navbar; revert when the promo ends. */}
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

							{/* Primary CTA - Maximum prominence */}
							<div className="animate-hero-enter hero-enter-delay-1 mt-8 md:mt-10 flex flex-col items-center gap-6">
								{/* Primary CTA - ShimmerButton with glow */}
								<div className="relative">
									{/* Outer glow ring */}
									<div className="absolute -inset-3 bg-blue-500/30 rounded-full blur-xl animate-pulse" />
									<AuthLink href="/signup" className="group relative">
										<ShimmerButton
											background="rgb(37, 99, 235)"
											className="shadow-2xl shadow-blue-500/25 px-10 md:px-12 py-3 md:py-4"
										>
											<span className="flex items-center gap-3 text-center text-xl leading-none font-bold tracking-tight whitespace-pre-wrap text-white md:text-2xl">
												<span>Get My API Key</span>
												<ArrowRight className="size-6 md:size-7 transition-transform group-hover:translate-x-1" />
											</span>
										</ShimmerButton>
									</AuthLink>
								</div>

								{/* Trust indicators */}
								<div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
									<span className="flex items-center gap-1.5">
										<svg
											className="size-4 text-green-500"
											fill="currentColor"
											viewBox="0 0 20 20"
											aria-hidden="true"
										>
											<path
												fillRule="evenodd"
												d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
												clipRule="evenodd"
											/>
										</svg>
										Bring your own keys — free forever
									</span>
									<span className="flex items-center gap-1.5">
										<svg
											className="size-4 text-green-500"
											fill="currentColor"
											viewBox="0 0 20 20"
											aria-hidden="true"
										>
											<path
												fillRule="evenodd"
												d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
												clipRule="evenodd"
											/>
										</svg>
										No credit card required
									</span>
									<span className="flex items-center gap-1.5">
										<svg
											className="size-4 text-green-500"
											fill="currentColor"
											viewBox="0 0 20 20"
											aria-hidden="true"
										>
											<path
												fillRule="evenodd"
												d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
												clipRule="evenodd"
											/>
										</svg>
										Setup in 30 seconds
									</span>
								</div>
							</div>
						</div>
					</div>

					<div className="animate-hero-enter hero-enter-delay-3">
						<div className="mx-auto mt-8 max-w-7xl px-4 pb-16 sm:mt-12 sm:px-6 md:mt-20 md:pb-24">
							<DashboardDemo />
							<dl className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-4">
								{STATS.map((stat) => (
									<div
										key={stat.label}
										className="flex flex-col-reverse bg-background px-5 py-4"
									>
										<dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
											{stat.label}
										</dt>
										<dd className="font-display text-2xl font-bold tracking-tight md:text-3xl">
											{stat.value}
										</dd>
									</div>
								))}
							</dl>
						</div>
					</div>
				</div>
			</section>
		</div>
	);
}
