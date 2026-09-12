import Link from "next/link";

import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { RESOURCE_PAGES } from "@/lib/resources";

import type { ReactNode } from "react";

export function ResourcePage({
	path,
	children,
}: {
	path: string;
	children: ReactNode;
}) {
	const resource = RESOURCE_PAGES.find((entry) => entry.href === path);
	if (!resource) {
		throw new Error(`Unknown resource: ${path}`);
	}
	const isTool = path.startsWith("/tools/");
	const schema = {
		"@context": "https://schema.org",
		"@type": isTool ? "WebApplication" : "Article",
		name: resource.title,
		headline: resource.title,
		description: resource.description,
		url: `https://airside.llmgateway.io${path}`,
		...(isTool
			? {
					applicationCategory: "UtilitiesApplication",
					operatingSystem: "Any",
					isAccessibleForFree: true,
				}
			: {
					author: {
						"@type": "Organization",
						name: "LLM Gateway",
						url: "https://llmgateway.io",
					},
					dateModified: "2026-09-11",
				}),
	};
	return (
		<div className="flex min-h-screen flex-col">
			<Header />
			<main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12 sm:px-6 sm:py-20">
				<script
					type="application/ld+json"
					// Static resource metadata, escaped for script context.
					// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
					dangerouslySetInnerHTML={{
						__html: JSON.stringify(schema).replace(/</g, "\\u003c"),
					}}
				/>
				<nav
					aria-label="Breadcrumb"
					className="text-muted-foreground mb-8 text-sm"
				>
					<Link href="/">Airside</Link> /{" "}
					<Link href="/resources">Provider resources</Link>
				</nav>
				<p className="text-primary mb-3 font-mono text-xs tracking-widest uppercase">
					{isTool ? "Free provider tool · No sign-in" : "Provider guide"}
				</p>
				<h1 className="font-display text-4xl font-black tracking-tight sm:text-5xl">
					{resource.title}
				</h1>
				<p className="text-muted-foreground mt-5 max-w-2xl text-lg">
					{resource.description}
				</p>
				{!isTool && (
					<p className="text-muted-foreground mt-4 text-sm">
						By LLM Gateway · Updated September 11, 2026
					</p>
				)}
				<article className="mt-10 space-y-8 [&_h2]:mb-3 [&_h2]:text-2xl [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:font-semibold [&_p]:leading-relaxed [&_li]:leading-relaxed [&_a]:underline [&_a]:underline-offset-4">
					{children}
				</article>
				<section className="border-primary/30 bg-primary/5 mt-12 rounded-xl border p-6">
					<h2 className="font-display text-2xl font-bold">
						Put your API in front of gateway users.
					</h2>
					<p className="text-muted-foreground mt-2 mb-5">
						Verify your provider, submit models and pricing, and track the
						traffic routed to your API.
					</p>
					<Button asChild>
						<Link href="/signup">Register your provider</Link>
					</Button>
				</section>
				<aside className="mt-12">
					<h2 className="mb-4 text-xl font-semibold">Related resources</h2>
					<ul className="grid gap-3 sm:grid-cols-2">
						{RESOURCE_PAGES.filter((entry) => entry.href !== path).map(
							(entry) => (
								<li key={entry.href}>
									<Link
										className="border-border hover:border-primary block rounded-lg border p-4 text-sm"
										href={entry.href}
									>
										{entry.title} →
									</Link>
								</li>
							),
						)}
					</ul>
				</aside>
			</main>
			<Footer />
		</div>
	);
}
