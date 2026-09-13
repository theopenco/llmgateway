import Link from "next/link";

import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { RESOURCE_PAGES } from "@/lib/resources";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "LLM provider guides and free tools",
	description:
		"Prepare an LLM API listing, plan inference pricing, estimate token costs and check request capacity with Airside’s free provider resources.",
	alternates: { canonical: "/resources" },
	openGraph: {
		title: "LLM provider guides and free tools",
		url: "/resources",
		description:
			"Practical guides and free calculators for inference providers.",
	},
	twitter: {
		title: "LLM provider guides and free tools",
		description:
			"Practical guides and free calculators for inference providers.",
	},
};

export default function Resources() {
	return (
		<>
			<Header />
			<main className="mx-auto min-h-[70vh] max-w-6xl px-4 py-16 sm:px-6">
				<p className="text-primary font-mono text-xs tracking-widest uppercase">
					Before your first request
				</p>
				<h1 className="font-display mt-4 max-w-3xl text-4xl font-black sm:text-5xl">
					LLM provider guides and free tools
				</h1>
				<p className="text-muted-foreground mt-5 max-w-2xl text-lg">
					Prepare your API for listing, understand your pricing and plan
					capacity. The calculators run in your browser and need no account.
				</p>
				{["guides", "tools"].map((section) => (
					<section key={section} className="mt-12">
						<h2 className="mb-5 text-2xl font-semibold">
							{section === "guides" ? "Provider guides" : "Free calculators"}
						</h2>
						<div className="grid gap-5 md:grid-cols-2">
							{RESOURCE_PAGES.filter((page) =>
								page.href.startsWith(`/${section}/`),
							).map((page) => (
								<Link
									key={page.href}
									href={page.href}
									className="border-border hover:border-primary rounded-xl border p-6"
								>
									<h3 className="mb-3 text-xl font-semibold">{page.title} →</h3>
									<p className="text-muted-foreground">{page.description}</p>
								</Link>
							))}
						</div>
					</section>
				))}
			</main>
			<Footer />
		</>
	);
}
