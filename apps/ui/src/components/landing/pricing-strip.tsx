"use client";

import { ArrowRight, KeyRound, Server, Wallet } from "lucide-react";
import Link from "next/link";

import { MARKETING_STATS } from "@llmgateway/shared";

import { AnimatedGroup } from "./animated-group";

const options = [
	{
		icon: Wallet,
		name: "Credits",
		price: `${MARKETING_STATS.platformFee} flat fee`,
		description:
			"Pay-as-you-go credits for any model at provider rates, with a flat platform fee on top-ups. No subscription, no markup on tokens.",
	},
	{
		icon: KeyRound,
		name: "Bring your own keys",
		price: "Free",
		description:
			"Route through your own provider API keys and pay providers directly. Routing, tracking, and analytics included at no cost.",
	},
	{
		icon: Server,
		name: "Self-host",
		price: "Free forever",
		description:
			"Deploy the AGPLv3-licensed gateway on your own infrastructure. The full routing layer, yours to run.",
	},
];

export function PricingStrip() {
	return (
		<section className="relative py-20 md:py-28">
			<div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
			<div className="container mx-auto px-4">
				<AnimatedGroup preset="blur-slide" className="text-center mb-12">
					<p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-4">
						Pricing
					</p>
					<h2 className="font-display text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight text-foreground">
						Three ways to run it. Two are free.
					</h2>
					<p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
						No seats, no minimums, no token markup. Start free and only pay when
						you top up credits.
					</p>
				</AnimatedGroup>

				<AnimatedGroup
					preset="slide"
					className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-5xl mx-auto"
				>
					{options.map((option) => (
						<div
							key={option.name}
							className="group rounded-xl border border-border/50 bg-card p-6 transition-all duration-300 hover:border-blue-500/30 hover:shadow-md hover:shadow-blue-500/5"
						>
							<div className="w-10 h-10 rounded-lg border border-border bg-muted flex items-center justify-center mb-4 transition-colors group-hover:border-blue-500/30 group-hover:bg-blue-500/5">
								<option.icon className="h-5 w-5 text-muted-foreground transition-colors group-hover:text-blue-500" />
							</div>
							<div className="flex items-baseline justify-between gap-2 mb-1.5">
								<h3 className="text-base font-semibold tracking-tight text-foreground">
									{option.name}
								</h3>
								<span className="text-sm font-mono font-semibold text-blue-500">
									{option.price}
								</span>
							</div>
							<p className="text-sm leading-relaxed text-muted-foreground">
								{option.description}
							</p>
						</div>
					))}
				</AnimatedGroup>

				<AnimatedGroup preset="fade" className="mt-8 text-center">
					<Link
						href="/pricing"
						className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
					>
						Compare all plans, including Enterprise
						<ArrowRight className="size-3.5" />
					</Link>
				</AnimatedGroup>
			</div>
		</section>
	);
}
