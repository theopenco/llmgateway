import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { getConfig } from "@/lib/config-server";

import { GuidesGrid } from "./GuidesGrid";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Guides — DevPass",
	description:
		"Setup guides for integrating DevPass with Claude Code, Cursor, Cline, n8n, OpenCode, and every other coding tool.",
	alternates: { canonical: "/guides" },
};

export default function GuidesPage() {
	const config = getConfig();

	return (
		<div className="min-h-screen bg-background">
			<Header />
			<main>
				<section className="py-20 sm:py-24 px-4">
					<div className="container mx-auto max-w-6xl">
						<div className="mx-auto max-w-2xl text-center mb-12">
							<h1 className="mb-4 text-4xl font-bold tracking-tight sm:text-5xl">
								Guides
							</h1>
							<p className="text-lg text-muted-foreground leading-relaxed">
								Step-by-step tutorials to wire your DevPass API key into every
								coding tool, terminal agent, and workflow.
							</p>
						</div>
						<GuidesGrid uiUrl={config.uiUrl} />
					</div>
				</section>
			</main>
			<Footer />
		</div>
	);
}
