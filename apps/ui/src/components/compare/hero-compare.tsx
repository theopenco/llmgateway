"use client";
import Link from "next/link";
import React from "react";

import { AuthLink } from "../shared/auth-link";
import { AnimatedGroup } from "@/components/landing/animated-group";
import { Navbar } from "@/components/landing/navbar";
import { Button } from "@/lib/components/button";

const transitionVariants = {
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
				type: "spring",
				bounce: 0.3,
				duration: 1.5,
			},
		},
	},
};

interface HeroContent {
	heading: string;
	description: string;
	badges?: string[];
	cta: {
		primary: {
			text: string;
			href: string;
			external?: boolean;
		};
		secondary: {
			text: string;
			href: string;
			external?: boolean;
		};
	};
}

interface HeroCompareProps {
	content?: HeroContent;
}

const defaultContent: HeroContent = {
	heading: "Why Choose LLM Gateway Over OpenRouter?",
	description:
		"Compare our unified API gateway with advanced routing, analytics, and cost optimization against OpenRouter's basic proxy service.",
	badges: [
		"Advanced Analytics",
		"Smart Routing",
		"Cost Optimization",
		"Enterprise Ready",
	],
	cta: {
		primary: {
			text: "Start for Free",
			href: "/signup",
		},
		secondary: {
			text: "View Docomentation",
			href: "https://docs.llmgateway.io",
			external: true,
		},
	},
};

export function HeroCompare({ content }: HeroCompareProps) {
	const heroContent = { ...defaultContent, ...content };

	return (
		<>
			<Navbar />
			<main className="overflow-hidden">
				<div
					aria-hidden
					className="z-[2] absolute inset-0 pointer-events-none isolate opacity-50 contain-strict hidden lg:block"
				>
					<div className="w-[35rem] h-[80rem] -translate-y-[350px] absolute left-0 top-0 -rotate-45 rounded-full bg-[radial-gradient(68.54%_68.72%_at_55.02%_31.46%,hsla(0,0%,85%,.08)_0,hsla(0,0%,55%,.02)_50%,hsla(0,0%,45%,0)_80%)]" />
					<div className="h-[80rem] absolute left-0 top-0 w-56 -rotate-45 rounded-full bg-[radial-gradient(50%_50%_at_50%_50%,hsla(0,0%,85%,.06)_0,hsla(0,0%,45%,.02)_80%,transparent_100%)] [translate:5%_-50%]" />
					<div className="h-[80rem] -translate-y-[350px] absolute left-0 top-0 w-56 -rotate-45 bg-[radial-gradient(50%_50%_at_50%_50%,hsla(0,0%,85%,.04)_0,hsla(0,0%,45%,.02)_80%,transparent_100%)]" />
				</div>
				<section>
					<div className="relative pt-24 md:pt-36 pb-24">
						<div
							aria-hidden
							className="absolute inset-0 -z-10 size-full [background:radial-gradient(125%_125%_at_50%_100%,transparent_0%,var(--background)_75%)]"
						/>
						<div className="mx-auto max-w-7xl px-6">
							<div className="text-center sm:mx-auto lg:mr-auto lg:mt-0">
								<AnimatedGroup variants={transitionVariants}>
									<h1 className="mt-8 max-w-4xl mx-auto text-balance text-6xl md:text-7xl lg:mt-16 xl:text-[5.25rem]">
										{heroContent.heading}
									</h1>
									<p className="mx-auto mt-8 max-w-2xl text-balance text-lg text-muted-foreground">
										{heroContent.description}
									</p>

									{heroContent.badges && heroContent.badges.length > 0 && (
										<div className="flex flex-wrap gap-2 justify-center mt-8">
											{heroContent.badges.map((badge, index) => (
												<span
													key={index}
													className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary ring-1 ring-inset ring-primary/20"
												>
													{badge}
												</span>
											))}
										</div>
									)}
								</AnimatedGroup>

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
									className="mt-12 flex flex-col items-center justify-center gap-2 md:flex-row"
								>
									<div
										key={1}
										className="bg-foreground/10 rounded-[14px] border p-0.5"
									>
										<Button
											asChild
											size="lg"
											className="rounded-xl px-5 text-base"
										>
											{heroContent.cta.primary.external ? (
												<a
													href={heroContent.cta.primary.href}
													target="_blank"
													rel="noopener noreferrer"
												>
													<span className="text-nowrap">
														{heroContent.cta.primary.text}
													</span>
												</a>
											) : (
												<AuthLink href={heroContent.cta.primary.href}>
													<span className="text-nowrap">
														{heroContent.cta.primary.text}
													</span>
												</AuthLink>
											)}
										</Button>
									</div>
									<Button
										key={2}
										asChild
										size="lg"
										variant="ghost"
										className="h-10.5 rounded-xl px-5"
									>
										{heroContent.cta.secondary.external ? (
											<a
												href={heroContent.cta.secondary.href}
												target="_blank"
												rel="noopener noreferrer"
											>
												<span className="text-nowrap">
													{heroContent.cta.secondary.text}
												</span>
											</a>
										) : (
											<Link
												href={heroContent.cta.secondary.href}
												prefetch={true}
											>
												<span className="text-nowrap">
													{heroContent.cta.secondary.text}
												</span>
											</Link>
										)}
									</Button>
								</AnimatedGroup>
							</div>
						</div>
					</div>
				</section>
			</main>
		</>
	);
}
