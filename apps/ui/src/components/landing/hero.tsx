"use client";

import { ArrowRight, ChevronRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { AuthLink } from "@/components/shared/auth-link";
import { ShimmerButton } from "@/lib/components/shimmer-button";

import { MARKETING_STATS } from "@llmgateway/shared";
import { providerLogoUrls } from "@llmgateway/shared/components";

import { Navbar } from "./navbar";

import type { ProviderId } from "@llmgateway/models";

// Provider logos configuration
const PROVIDER_LOGOS: { name: string; providerId: ProviderId }[] = [
	{ name: "OpenAI", providerId: "openai" },
	{ name: "Anthropic", providerId: "anthropic" },
	{ name: "Together AI", providerId: "together-ai" },
	{ name: "Groq", providerId: "groq" },
	{ name: "xAI", providerId: "xai" },
	{ name: "DeepSeek", providerId: "deepseek" },
	{ name: "Perplexity", providerId: "perplexity" },
	{ name: "Ai Studio", providerId: "google-ai-studio" },
	{ name: "Moonshot", providerId: "moonshot" },
	{ name: "Novita", providerId: "novita" },
	{ name: "Nebius", providerId: "nebius" },
	{ name: "Zai", providerId: "zai" },
	{ name: "NanoGPT", providerId: "nanogpt" },
	{ name: "Canopywave", providerId: "canopywave" },
	{ name: "AWS Bedrock", providerId: "aws-bedrock" },
	{ name: "Azure", providerId: "azure" },
	{ name: "Inference.net", providerId: "inference.net" },
	{ name: "Mistral", providerId: "mistral" },
	{ name: "Alibaba", providerId: "alibaba" },
	{ name: "ByteDance", providerId: "bytedance" },
	{ name: "Cerebras", providerId: "cerebras" },
	{ name: "Google Vertex", providerId: "google-vertex" },
	{ name: "MiniMax", providerId: "minimax" },
];

interface MigrationData {
	slug: string;
	title: string;
	fromProvider: string;
}

const providerIcons: Record<string, React.ReactNode> = {
	"GitHub Copilot": (
		<svg
			fill="currentColor"
			fillRule="evenodd"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
			className="size-5"
			aria-hidden="true"
		>
			<path d="M19.245 5.364c1.322 1.36 1.877 3.216 2.11 5.817.622 0 1.2.135 1.592.654l.73.964c.21.278.323.61.323.955v2.62c0 .339-.173.669-.453.868C20.239 19.602 16.157 21.5 12 21.5c-4.6 0-9.205-2.583-11.547-4.258-.28-.2-.452-.53-.453-.868v-2.62c0-.345.113-.679.321-.956l.73-.963c.392-.517.974-.654 1.593-.654l.029-.297c.25-2.446.81-4.213 2.082-5.52 2.461-2.54 5.71-2.851 7.146-2.864h.198c1.436.013 4.685.323 7.146 2.864m-7.244 4.328c-.284 0-.613.016-.962.05-.123.447-.305.85-.57 1.108-1.05 1.023-2.316 1.18-2.994 1.18-.638 0-1.306-.13-1.851-.464-.516.165-1.012.403-1.044.996a65.882 65.882 0 0 0-.063 2.884l-.002.48c-.002.563-.005 1.126-.013 1.69.002.326.204.63.51.765 2.482 1.102 4.83 1.657 6.99 1.657 2.156 0 4.504-.555 6.985-1.657a.854.854 0 0 0 .51-.766c.03-1.682.006-3.372-.076-5.053-.031-.596-.528-.83-1.046-.996-.546.333-1.212.464-1.85.464-.677 0-1.942-.157-2.993-1.18-.266-.258-.447-.661-.57-1.108-.32-.032-.64-.049-.96-.05zm-2.525 4.013c.539 0 .976.426.976.95v1.753c0 .525-.437.95-.976.95a.964.964 0 0 1-.976-.95v-1.752c0-.525.437-.951.976-.951m5 0c.539 0 .976.426.976.95v1.753c0 .525-.437.95-.976.95a.964.964 0 0 1-.976-.95v-1.752c0-.525.437-.951.976-.951M7.635 5.087c-1.05.102-1.935.438-2.385.906-.975 1.037-.765 3.668-.21 4.224.405.394 1.17.657 1.995.657h.09c.649-.013 1.785-.176 2.73-1.11.435-.41.705-1.433.675-2.47-.03-.834-.27-1.52-.63-1.813-.39-.336-1.275-.482-2.265-.394m6.465.394c-.36.292-.6.98-.63 1.813-.03 1.037.24 2.06.675 2.47.968.957 2.136 1.104 2.776 1.11h.044c.825 0 1.59-.263 1.995-.657.555-.556.765-3.187-.21-4.224-.45-.468-1.335-.804-2.385-.906-.99-.088-1.875.058-2.265.394M12 7.615c-.24 0-.525.015-.84.044.03.16.045.336.06.526l-.001.159a2.94 2.94 0 0 1-.014.25c.225-.022.425-.027.612-.028h.366c.187 0 .387.006.612.028-.015-.146-.015-.277-.015-.409.015-.19.03-.365.06-.526a9.29 9.29 0 0 0-.84-.044" />
		</svg>
	),
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
									<div className="animate-hero-enter">
										<Link
											href="/blog/soc2-type-ii"
											className="hover:bg-background dark:hover:border-t-border bg-muted group flex w-fit items-center gap-4 rounded-full border p-1 pl-4 shadow-md shadow-black/5 transition-all duration-300 dark:border-t-white/5 dark:shadow-zinc-950"
										>
											<span className="text-foreground text-sm">
												LLM Gateway Is Now SOC 2 Type II Certified
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
									<div className="animate-hero-enter">
										<h1 className="text-balance text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-foreground">
											LLM Gateway — One API for {MARKETING_STATS.providers}{" "}
											providers, including OpenAI, Anthropic, and Google
										</h1>
										<p className="mt-4 md:mt-6 max-w-2xl mx-auto text-balance text-base md:text-lg text-muted-foreground">
											Stop juggling API keys and provider dashboards. Route
											requests across {MARKETING_STATS.models} models, track
											costs in real-time, and switch providers without changing
											your code.
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

							{/* Migration guides section */}
							{migrations.length > 0 && (
								<div className="animate-hero-enter hero-enter-delay-2">
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
														{providerIcons[migration.fromProvider] ?? (
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
								</div>
							)}

							<div className="animate-hero-enter hero-enter-delay-3">
								<div className="relative -mr-56 mt-8 overflow-hidden px-2 sm:mr-0 sm:mt-12 md:mt-20">
									<div
										aria-hidden
										className="bg-linear-to-b to-background absolute inset-0 z-10 from-transparent from-35%"
									/>
									<div className="inset-shadow-2xs ring-background dark:inset-shadow-white/20 bg-background relative mx-auto max-w-6xl overflow-hidden rounded-2xl border p-4 shadow-lg shadow-zinc-950/15 ring-1">
										{/*
										 * Both theme variants stay in the DOM (CSS decides which
										 * shows). Default lazy loading means the display:none one
										 * is never downloaded, and neither competes with the LCP
										 * headline for bandwidth.
										 */}
										<Image
											className="bg-background aspect-[3022/1650] relative hidden rounded-2xl dark:block"
											src="/new-hero.png"
											alt="LLM Gateway dashboard showing analytics and API usage"
											width={3022}
											height={1650}
											sizes="(max-width: 1280px) 100vw, 1120px"
										/>
										<Image
											className="z-2 border-border/25 aspect-[3022/1650] relative rounded-2xl border dark:hidden"
											src="/new-hero-light.png"
											alt="LLM Gateway dashboard showing analytics and API usage"
											width={3022}
											height={1650}
											sizes="(max-width: 1280px) 100vw, 1120px"
										/>
									</div>
								</div>
							</div>
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
							<div className="group-hover:blur-xs mx-auto mt-12 grid max-w-3xl grid-cols-5 gap-x-10 gap-y-6 transition-all duration-500 group-hover:opacity-50 sm:grid-cols-6 sm:gap-x-12 sm:gap-y-10 lg:grid-cols-8">
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
