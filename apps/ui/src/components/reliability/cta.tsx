"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/lib/components/button";

export function ReliabilityCTA() {
	return (
		<section className="py-20 sm:py-28">
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				<div className="mx-auto max-w-4xl">
					<div className="overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.04] via-transparent to-transparent p-8 text-center sm:p-12">
						<h2 className="mb-4 text-3xl font-bold tracking-tight text-balance sm:text-4xl">
							Stop babysitting provider dashboards.
						</h2>
						<p className="mx-auto mb-8 max-w-2xl text-base leading-relaxed text-muted-foreground text-balance sm:text-lg">
							Switch your base URL to LLM Gateway and get automatic failover,
							real-time health monitoring, and uptime reporting across 25+
							providers — in one line of code.
						</p>
						<div className="flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
							<Button size="lg" className="w-full sm:w-auto" asChild>
								<Link href="/signup">
									Get Started Free
									<ArrowRight className="ml-2 h-4 w-4" />
								</Link>
							</Button>
							<Button
								size="lg"
								variant="outline"
								className="w-full bg-transparent sm:w-auto"
								asChild
							>
								<Link href="/enterprise#contact">Talk to Sales</Link>
							</Button>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}
