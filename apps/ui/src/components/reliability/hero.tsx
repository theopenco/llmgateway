"use client";

import { ArrowRight, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { Button } from "@/lib/components/button";
import { NumberTicker } from "@/lib/components/number-ticker";

interface StatProps {
	value: number;
	suffix?: string;
	prefix?: string;
	label: string;
	delay?: number;
	decimalPlaces?: number;
}

function Stat({
	value,
	suffix = "",
	prefix = "",
	label,
	delay,
	decimalPlaces,
}: StatProps) {
	return (
		<div className="flex flex-col items-center rounded-2xl border border-border bg-card/50 p-6 backdrop-blur-sm transition-all duration-300 hover:border-primary/50">
			<div className="flex items-baseline justify-center whitespace-nowrap text-xl font-bold text-primary sm:text-2xl lg:text-3xl">
				{prefix}
				<NumberTicker
					value={value}
					delay={delay}
					decimalPlaces={decimalPlaces}
					className="text-primary"
				/>
				{suffix}
			</div>
			<span className="mt-2 text-center text-sm font-medium text-muted-foreground">
				{label}
			</span>
		</div>
	);
}

export function ReliabilityHero() {
	return (
		<section className="relative pt-32 pb-20 sm:pt-40 sm:pb-28">
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				<div className="mx-auto max-w-4xl text-center">
					<div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-1.5">
						<span className="relative flex h-2 w-2">
							<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
							<span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
						</span>
						<span className="text-xs font-mono text-emerald-600 dark:text-emerald-400">
							RELIABILITY
						</span>
						<span className="text-xs text-muted-foreground">
							99.9999% effective uptime
						</span>
					</div>
					<h1 className="mb-6 text-4xl font-bold tracking-tight text-balance sm:text-6xl lg:text-7xl">
						Your AI app can&apos;t afford to go down.
					</h1>
					<p className="mx-auto mb-10 max-w-3xl text-lg leading-relaxed text-balance text-muted-foreground sm:text-xl">
						LLM Gateway automatically routes requests to healthy providers in
						real time. When one goes down, your traffic seamlessly fails over —
						your users never notice.
					</p>
					<div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
						<Button size="lg" className="w-full sm:w-auto" asChild>
							<Link href="/signup">
								Start Routing in Minutes
								<ArrowRight className="ml-2 h-4 w-4" />
							</Link>
						</Button>
						<Button
							size="lg"
							variant="outline"
							className="w-full bg-transparent sm:w-auto"
							asChild
						>
							<Link href="/enterprise#contact">
								<ShieldCheck className="mr-2 h-4 w-4" />
								Talk to Sales
							</Link>
						</Button>
					</div>

					<div className="mt-16 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:gap-6">
						<Stat
							value={99.9999}
							suffix="%"
							label="Effective uptime"
							decimalPlaces={4}
						/>
						<Stat
							value={32}
							prefix="<"
							suffix="s"
							label="Downtime per year"
							delay={0.1}
						/>
						<Stat value={25} suffix="+" label="Providers" delay={0.2} />
						<Stat value={0} suffix="ms" label="Failover overhead" delay={0.3} />
					</div>
				</div>
			</div>
		</section>
	);
}
