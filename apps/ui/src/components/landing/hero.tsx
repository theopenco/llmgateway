"use client";

import { ArrowRight, ChevronRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { AuthLink } from "@/components/shared/auth-link";
import { Button } from "@/lib/components/button";
import { ShimmerButton } from "@/lib/components/shimmer-button";
import { useAppConfig } from "@/lib/config";

import { providerLogoUrls } from "@llmgateway/shared/components";

import { AnimatedGroup } from "./animated-group";
import { Navbar } from "./navbar";

import type { Variants } from "@/components/motion-wrapper";
import type { ProviderId } from "@llmgateway/models";

const transitionVariants: { item: Variants } = {
	item: {
		hidden: {
			opacity: 0,
			filter: "blur(12px)",
			y: 12,
		},
		visible: {
			opacity: 1,
			filter: "blur(0px)",
			y: 0,
			transition: {
				type: "spring" as const,
				bounce: 0.3,
				duration: 1.5,
			},
		},
	},
};

// Provider logos configuration
const PROVIDER_LOGOS: { name: string; providerId: ProviderId }[] = [
	{ name: "OpenAI", providerId: "openai" },
	{ name: "Anthropic", providerId: "anthropic" },
	{ name: "Together AI", providerId: "together.ai" },
	{ name: "Cloudrift", providerId: "cloudrift" },
	{ name: "Groq", providerId: "groq" },
	{ name: "xAI", providerId: "xai" },
	{ name: "DeepSeek", providerId: "deepseek" },
	{ name: "Perplexity", providerId: "perplexity" },
	{ name: "Ai Studio", providerId: "google-ai-studio" },
	{ name: "Moonshot", providerId: "moonshot" },
	{ name: "Novita", providerId: "novita" },
	{ name: "Nebius", providerId: "nebius" },
	{ name: "Zai", providerId: "zai" },
	{ name: "Routeway", providerId: "routeway" },
	{ name: "NanoGPT", providerId: "nanogpt" },
	{ name: "Canopywave", providerId: "canopywave" },
	{ name: "AWS Bedrock", providerId: "aws-bedrock" },
	{ name: "Azure", providerId: "azure" },
	{ name: "Inference.net", providerId: "inference.net" },
];

interface MigrationData {
	slug: string;
	title: string;
	fromProvider: string;
}

const providerIcons: Record<string, React.ReactNode> = {
	OpenRouter: (
		<svg
			fill="currentColor"
			fillRule="evenodd"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
			className="size-5"
			aria-hidden="true"
		>
			<path d="m16.804 1.957 7.22 4.105v.087L16.73 10.21l.017-2.117-.821-.03c-1.059-.028-1.611.002-2.268.11-1.064.175-2.038.577-3.147 1.352L8.345 11.03c-.284.195-.495.336-.68.455l-.515.322-.397.234.385.23.53.338c.476.314 1.17.796 2.701 1.866 1.11.775 2.083 1.177 3.147 1.352l.3.045c.694.091 1.375.094 2.825.033l.022-2.159 7.22 4.105v.087L16.589 22l.014-1.862-.635.022c-1.386.042-2.137.002-3.138-.162-1.694-.28-3.26-.926-4.881-2.059l-2.158-1.5a21.997 21.997 0 0 0-.755-.498l-.467-.28a55.927 55.927 0 0 0-.76-.43C2.908 14.73.563 14.116 0 14.116V9.888l.14.004c.564-.007 2.91-.622 3.809-1.124l1.016-.58.438-.274c.428-.28 1.072-.726 2.686-1.853 1.621-1.133 3.186-1.78 4.881-2.059 1.152-.19 1.974-.213 3.814-.138z" />
		</svg>
	),
	"Vercel AI Gateway": (
		<svg
			viewBox="0 0 76 65"
			fill="currentColor"
			className="size-5"
			aria-hidden="true"
		>
			<path d="M37.5274 0L75.0548 65H0L37.5274 0Z" />
		</svg>
	),
	LiteLLM: (
		<span className="text-lg" role="img" aria-label="LiteLLM">
			🚅
		</span>
	),
};

export function Hero({
	navbarOnly,
	sticky = true,
	children,
	migrations = [],
}: {
	navbarOnly?: boolean;
	sticky?: boolean;
	children: React.ReactNode;
	migrations?: MigrationData[];
}) {
	const config = useAppConfig();

	return (
		<>
			<Navbar sticky={sticky}>{children}</Navbar>
			{!navbarOnly && (
				<main className="overflow-hidden">
					<div
						aria-hidden
						className="z-2 absolute inset-0 pointer-events-none isolate opacity-50 contain-strict hidden lg:block"
					>
						<div className="w-140 h-320 -translate-y-[350px] absolute left-0 top-0 -rotate-45 rounded-full bg-[radial-gradient(68.54%_68.72%_at_55.02%_31.46%,hsla(0,0%,85%,.08)_0,hsla(0,0%,55%,.02)_50%,hsla(0,0%,45%,0)_80%)]" />
						<div className="h-320 absolute left-0 top-0 w-56 -rotate-45 rounded-full bg-[radial-gradient(50%_50%_at_50%_50%,hsla(0,0%,85%,.06)_0,hsla(0,0%,45%,.02)_80%,transparent_100%)] [translate:5%_-50%]" />
						<div className="h-320 -translate-y-[350px] absolute left-0 top-0 w-56 -rotate-45 bg-[radial-gradient(50%_50%_at_50%_50%,hsla(0,0%,85%,.04)_0,hsla(0,0%,45%,.02)_80%,transparent_100%)]" />
					</div>
					<section>
						<div className="relative pt-24 md:pt-36">
							<div
								aria-hidden
								className="absolute inset-0 -z-10 size-full [background:radial-gradient(125%_125%_at_50%_100%,transparent_0%,var(--background)_75%)]"
							/>
							<div className="mx-auto max-w-7xl px-6">
								{/* Announcement badge - centered */}
								<div className="mb-10 lg:mb-12 flex justify-center">
									<AnimatedGroup variants={transitionVariants}>
										<Link
											href="/changelog/gemini-3-pro-preview-support"
											className="hover:bg-background dark:hover:border-t-border bg-muted group flex w-fit items-center gap-4 rounded-full border p-1 pl-4 shadow-md shadow-black/5 transition-all duration-300 dark:border-t-white/5 dark:shadow-zinc-950"
										>
											<span className="text-foreground text-sm">
												Gemini 3 is live with a 20% discount
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
									</AnimatedGroup>
								</div>

								{/* Centered hero content - optimized for conversion */}
								<div className="text-center max-w-4xl mx-auto">
									<AnimatedGroup variants={transitionVariants}>
										<h1 className="text-balance text-2xl md:text-3xl lg:text-4xl font-medium tracking-tight text-foreground/80">
											One API for every LLM. Any model, any provider.
										</h1>
										<p className="mt-4 md:mt-6 max-w-2xl mx-auto text-balance text-base md:text-lg text-muted-foreground">
											Stop juggling API keys and provider dashboards. Route
											requests to 180+ models, track costs in real-time, and
											switch providers without changing your code.
										</p>
									</AnimatedGroup>

									{/* Primary CTA - Maximum prominence */}
									<AnimatedGroup
										variants={{
											container: {
												visible: {
													transition: {
														staggerChildren: 0.05,
														delayChildren: 0.5,
													},
												},
											},
											...transitionVariants,
										}}
										className="mt-8 md:mt-10 flex flex-col items-center gap-6"
									>
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
												Free tier included
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

										{/* Secondary CTA - De-emphasized */}
										<Button
											asChild
											variant="ghost"
											className="text-muted-foreground hover:text-foreground"
										>
											<a href={config.docsUrl ?? ""} target="_blank">
												<span>View documentation</span>
												<ChevronRight className="size-4" />
											</a>
										</Button>
									</AnimatedGroup>
								</div>
							</div>

							{/* Migration guides section */}
							{migrations.length > 0 && (
								<AnimatedGroup
									variants={{
										container: {
											visible: {
												transition: {
													staggerChildren: 0.05,
													delayChildren: 0.6,
												},
											},
										},
										...transitionVariants,
									}}
								>
									<div className="mx-auto mt-10 max-w-4xl px-6">
										<p className="mb-4 text-center text-sm text-muted-foreground">
											Switching from another provider?
										</p>
										<div className="flex flex-wrap items-center justify-center gap-3">
											{migrations.map((migration) => (
												<Link
													key={migration.slug}
													href={`/migration/${migration.slug}`}
													className="group/card flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm transition-colors hover:border-primary/50 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
												>
													<span className="flex size-6 items-center justify-center text-muted-foreground transition-colors group-hover/card:text-foreground">
														{providerIcons[migration.fromProvider] || (
															<ChevronRight
																className="size-4"
																aria-hidden="true"
															/>
														)}
													</span>
													<span className="text-muted-foreground transition-colors group-hover/card:text-foreground">
														{migration.fromProvider}
													</span>
													<ArrowRight
														className="size-3 text-muted-foreground transition-transform group-hover/card:translate-x-0.5 group-hover/card:text-primary"
														aria-hidden="true"
													/>
												</Link>
											))}
											<Link
												href="/migration"
												className="flex items-center gap-1 rounded-full px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
											>
												<span>View all</span>
												<ChevronRight className="size-3" aria-hidden="true" />
											</Link>
										</div>
									</div>
								</AnimatedGroup>
							)}

							<AnimatedGroup
								variants={{
									container: {
										visible: {
											transition: {
												staggerChildren: 0.05,
												delayChildren: 0.75,
											},
										},
									},
									...transitionVariants,
								}}
							>
								<div className="relative -mr-56 mt-8 overflow-hidden px-2 sm:mr-0 sm:mt-12 md:mt-20">
									<div
										aria-hidden
										className="bg-linear-to-b to-background absolute inset-0 z-10 from-transparent from-35%"
									/>
									<div className="inset-shadow-2xs ring-background dark:inset-shadow-white/20 bg-background relative mx-auto max-w-6xl overflow-hidden rounded-2xl border p-4 shadow-lg shadow-zinc-950/15 ring-1">
										<Image
											className="bg-background aspect-15/8 relative hidden rounded-2xl dark:block"
											src="/new-hero.png"
											alt="LLM Gateway dashboard showing analytics and API usage"
											width={2696}
											height={1386}
											priority
										/>
										<Image
											className="z-2 border-border/25 aspect-15/8 relative rounded-2xl border dark:hidden"
											src="/new-hero-light.png"
											alt="LLM Gateway dashboard showing analytics and API usage"
											width={2696}
											height={1386}
											priority
										/>
									</div>
								</div>
							</AnimatedGroup>
						</div>
					</section>
					<section className="bg-background pb-16 pt-16 md:pb-32">
						<div className="group relative m-auto max-w-5xl px-6">
							<div className="absolute inset-0 z-10 flex scale-95 items-center justify-center opacity-0 duration-500 group-hover:scale-100 group-hover:opacity-100">
								<Link
									href="/providers"
									className="block text-sm duration-150 hover:opacity-75"
									prefetch={true}
								>
									<span>View All Providers</span>
									<ChevronRight className="ml-1 inline-block size-3" />
								</Link>
							</div>
							<div className="group-hover:blur-xs mx-auto mt-12 grid max-w-2xl grid-cols-5 gap-x-12 gap-y-8 transition-all duration-500 group-hover:opacity-50 sm:gap-x-16 sm:gap-y-14">
								{PROVIDER_LOGOS.map((provider) => {
									const LogoComponent = providerLogoUrls[provider.providerId];

									return (
										<div key={provider.name} className="flex">
											{LogoComponent && (
												<LogoComponent className="mx-auto h-16 w-fit object-contain" />
											)}
										</div>
									);
								})}
							</div>
						</div>
					</section>
				</main>
			)}
		</>
	);
}
