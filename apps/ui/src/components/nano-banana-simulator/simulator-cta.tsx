"use client";

import Link from "next/link";

import { AuthLink } from "@/components/shared/auth-link";
import { Button } from "@/lib/components/button";

export function SimulatorCta({ discount }: { discount: number }) {
	return (
		<section className="py-20 border-t border-zinc-200 dark:border-zinc-800">
			<div className="container mx-auto px-4">
				<div className="max-w-3xl mx-auto text-center">
					<h2 className="text-3xl font-bold tracking-tight mb-6 text-zinc-900 dark:text-white">
						Start Saving on Image Generation Today
					</h2>
					<p className="text-zinc-600 dark:text-zinc-400 mb-10">
						Get {discount}% off Gemini 3 Pro image generation with LLM Gateway.
						No credit card required to start.
					</p>

					<div className="flex flex-col sm:flex-row items-center justify-center gap-4">
						<Button
							className="bg-zinc-900 dark:bg-white text-white dark:text-black hover:bg-zinc-700 dark:hover:bg-zinc-200 px-8 py-6 text-base w-full sm:w-auto font-medium"
							asChild
						>
							<AuthLink href="/signup">Create Free Account</AuthLink>
						</Button>
						<Button
							variant="outline"
							className="border-zinc-300 dark:border-zinc-800 bg-transparent text-zinc-900 dark:text-white hover:text-black dark:hover:text-white hover:border-zinc-500 dark:hover:border-zinc-700 px-8 py-6 text-base w-full sm:w-auto"
							asChild
						>
							<Link href="/models" prefetch={true}>
								Explore All Models
							</Link>
						</Button>
					</div>
				</div>
			</div>
		</section>
	);
}
