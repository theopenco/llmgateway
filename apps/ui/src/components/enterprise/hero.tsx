import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/lib/components/button";

export function HeroEnterprise() {
	return (
		<section className="relative pt-32 pb-20 sm:pt-40 sm:pb-28">
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				<div className="mx-auto max-w-4xl text-center">
					<div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-muted px-4 py-1.5">
						<span className="text-xs font-mono text-blue-500">ENTERPRISE</span>
						<span className="text-xs text-muted-foreground">
							Production-ready LLM infrastructure
						</span>
					</div>
					<h1 className="mb-6 text-4xl font-bold tracking-tight text-balance sm:text-6xl lg:text-7xl">
						Enterprise LLM Gateway for mission-critical applications
					</h1>
					<p className="mb-10 text-lg text-muted-foreground text-balance sm:text-xl max-w-2xl mx-auto leading-relaxed">
						Deploy a fully-managed or self-hosted LLM gateway with enterprise
						SSO, white-labeling, and infrastructure-as-code support for your
						cloud or bare metal infrastructure.
					</p>
					<div className="flex flex-col sm:flex-row items-center justify-center gap-4">
						<Button size="lg" className="w-full sm:w-auto" asChild>
							<Link href="/enterprise#contact">
								Contact Us
								<ArrowRight className="ml-2 h-4 w-4" />
							</Link>
						</Button>
						<Button
							size="lg"
							variant="outline"
							className="w-full sm:w-auto bg-transparent"
							asChild
						>
							<Link href="/signup">Explore The Product</Link>
						</Button>
					</div>
				</div>
			</div>
		</section>
	);
}
