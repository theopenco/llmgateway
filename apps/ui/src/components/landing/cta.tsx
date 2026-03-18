"use client";
import { AuthLink } from "@/components/shared/auth-link";
import { Button } from "@/lib/components/button";
import { ShimmerButton } from "@/lib/components/shimmer-button";
import { useAppConfig } from "@/lib/config";

import { AnimatedGroup } from "./animated-group";

export default function CallToAction() {
	const config = useAppConfig();
	return (
		<section className="relative py-32 md:py-40 overflow-hidden">
			{/* Gradient separator at top */}
			<div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />

			{/* Atmospheric background */}
			<div className="absolute inset-0 bg-gradient-to-b from-background via-foreground/[0.02] to-background" />

			{/* Soft radial glow */}
			<div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-blue-500/[0.06] dark:bg-purple-500/[0.06] rounded-full blur-3xl pointer-events-none" />

			<div className="container relative mx-auto px-4">
				<div className="max-w-3xl mx-auto text-center">
					<AnimatedGroup preset="blur-slide" className="space-y-6">
						<h2 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-foreground">
							Start routing requests
							<br />
							in 30 seconds
						</h2>
						<p className="text-lg text-muted-foreground max-w-xl mx-auto">
							Join thousands of developers processing 100B+ tokens through LLM
							Gateway. Free tier included, no credit card required.
						</p>
					</AnimatedGroup>

					<AnimatedGroup
						preset="blur-slide"
						className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4"
					>
						<AuthLink href="/signup" className="w-full sm:w-auto">
							<ShimmerButton
								background="rgb(37, 99, 235)"
								className="shadow-2xl shadow-blue-500/25 px-8 py-4 text-base font-medium w-full sm:w-auto"
							>
								Create Free Account
							</ShimmerButton>
						</AuthLink>
						<Button
							variant="outline"
							className="border-border bg-transparent text-foreground hover:bg-muted px-8 py-6 text-base w-full sm:w-auto"
							asChild
						>
							<a href={config.githubUrl ?? ""} target="_blank">
								Self-host LLM Gateway
							</a>
						</Button>
					</AnimatedGroup>
				</div>
			</div>
		</section>
	);
}
