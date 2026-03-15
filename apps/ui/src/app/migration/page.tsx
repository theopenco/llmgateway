import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";

import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";

import type { Migration } from "content-collections";

export const metadata = {
	title: "Migration Guides | LLM Gateway",
	description:
		"Step-by-step guides to migrate from OpenRouter, Vercel AI Gateway, LiteLLM, and other LLM providers to LLM Gateway.",
	openGraph: {
		title: "Migration Guides | LLM Gateway",
		description:
			"Step-by-step guides to migrate from OpenRouter, Vercel AI Gateway, LiteLLM, and other LLM providers to LLM Gateway.",
	},
};

const providerIcons: Record<string, React.ReactNode> = {
	OpenRouter: (
		<svg
			fill="currentColor"
			fillRule="evenodd"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
			className="h-8 w-8"
		>
			<path d="m16.804 1.957 7.22 4.105v.087L16.73 10.21l.017-2.117-.821-.03c-1.059-.028-1.611.002-2.268.11-1.064.175-2.038.577-3.147 1.352L8.345 11.03c-.284.195-.495.336-.68.455l-.515.322-.397.234.385.23.53.338c.476.314 1.17.796 2.701 1.866 1.11.775 2.083 1.177 3.147 1.352l.3.045c.694.091 1.375.094 2.825.033l.022-2.159 7.22 4.105v.087L16.589 22l.014-1.862-.635.022c-1.386.042-2.137.002-3.138-.162-1.694-.28-3.26-.926-4.881-2.059l-2.158-1.5a21.997 21.997 0 0 0-.755-.498l-.467-.28a55.927 55.927 0 0 0-.76-.43C2.908 14.73.563 14.116 0 14.116V9.888l.14.004c.564-.007 2.91-.622 3.809-1.124l1.016-.58.438-.274c.428-.28 1.072-.726 2.686-1.853 1.621-1.133 3.186-1.78 4.881-2.059 1.152-.19 1.974-.213 3.814-.138z" />
		</svg>
	),
	"Vercel AI Gateway": (
		<svg viewBox="0 0 76 65" fill="currentColor" className="h-8 w-8">
			<path d="M37.5274 0L75.0548 65H0L37.5274 0Z" />
		</svg>
	),
	LiteLLM: <span className="text-3xl">🚅</span>,
};

export default async function MigrationPage() {
	const { allMigrations } = await import("content-collections");

	return (
		<div>
			<HeroRSC navbarOnly />
			<section className="py-20 sm:py-28">
				<div className="container mx-auto px-4 sm:px-6 lg:px-8">
					<div className="mx-auto max-w-2xl text-center mb-16">
						<h1 className="mb-4 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
							Migration Guides
						</h1>
						<p className="text-lg text-muted-foreground leading-relaxed">
							Switch to LLM Gateway from other LLM providers with minimal code
							changes. Our OpenAI-compatible API makes migration
							straightforward.
						</p>
					</div>

					<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 max-w-5xl mx-auto">
						{allMigrations.map((migration: Migration) => (
							<Link
								key={migration.slug}
								href={`/migration/${migration.slug}`}
								className="group relative flex flex-col rounded-xl border border-border bg-card p-6 transition-all hover:border-primary/50 hover:shadow-lg"
							>
								<div className="mb-4 flex h-14 w-14 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors">
									{providerIcons[migration.fromProvider] ?? (
										<svg
											viewBox="0 0 24 24"
											fill="none"
											xmlns="http://www.w3.org/2000/svg"
											className="h-8 w-8"
										>
											<path
												d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
												stroke="currentColor"
												strokeWidth="2"
												strokeLinecap="round"
												strokeLinejoin="round"
											/>
										</svg>
									)}
								</div>
								<h2 className="mb-2 text-xl font-semibold group-hover:text-primary transition-colors">
									{migration.title}
								</h2>
								<p className="mb-4 text-sm text-muted-foreground flex-grow">
									{migration.description}
								</p>
								<div className="flex items-center text-sm font-medium text-primary">
									Read guide
									<ArrowRightIcon className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1" />
								</div>
							</Link>
						))}
					</div>

					<div className="mt-16 mx-auto max-w-2xl text-center">
						<div className="rounded-xl border border-border bg-muted/50 p-8">
							<h2 className="mb-2 text-xl font-semibold">
								Don't see your provider?
							</h2>
							<p className="mb-4 text-muted-foreground">
								LLM Gateway's OpenAI-compatible API works with any client that
								supports OpenAI. Just change the base URL and API key.
							</p>
							<Link
								href="https://docs.llmgateway.io/quick-start"
								className="inline-flex items-center text-sm font-medium text-primary hover:underline"
							>
								View Quick Start Guide
								<ArrowRightIcon className="ml-1 h-4 w-4" />
							</Link>
						</div>
					</div>
				</div>
			</section>
			<Footer />
		</div>
	);
}
