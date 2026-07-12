import { ArrowRightIcon } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";

import { HeroRSC } from "@/components/landing/hero-rsc";

import { allMigrations } from "content-collections";

const Footer = dynamic(() => import("@/components/landing/footer"));

export const metadata = {
	title: "Migration Guides — From Copilot, OpenRouter, LiteLLM",
	description:
		"Step-by-step guides to migrate from GitHub Copilot, OpenRouter, Vercel AI Gateway, LiteLLM, Portkey, and other LLM providers to LLM Gateway.",
	openGraph: {
		title: "Migration Guides — From Copilot, OpenRouter, LiteLLM",
		description:
			"Step-by-step guides to migrate from GitHub Copilot, OpenRouter, Vercel AI Gateway, LiteLLM, Portkey, and other LLM providers to LLM Gateway.",
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
	"GitHub Copilot": (
		<svg
			viewBox="0 0 24 24"
			fill="currentColor"
			xmlns="http://www.w3.org/2000/svg"
			className="h-8 w-8"
		>
			<path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
		</svg>
	),
	Portkey: (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			fill="none"
			viewBox="0 0 180 180"
			className="h-8 w-8"
		>
			<path
				fill="url(#portkey-logo-gradient)"
				d="M109.063 7.5c14.782 0 28.37 7.992 35.766 20.851l23.12 40.191.346.614c7.159 12.942 7.078 28.784-.258 41.663l-23.179 40.68c-7.374 12.944-21.01 21.001-35.855 21.001H64.215c-14.95 0-28.669-8.17-36.004-21.26l-22.79-40.68c-7.256-12.951-7.227-28.838.082-41.759l22.738-40.19C35.598 15.604 49.266 7.5 64.156 7.5zM64.156 28.05c-7.392 0-14.312 4.021-18.088 10.696L23.33 78.936c-3.767 6.659-3.783 14.88-.044 21.556l22.797 40.687.178.314c3.803 6.531 10.647 10.457 17.953 10.457h44.788c7.37 0 14.274-3.997 18.057-10.639l23.173-40.681c3.842-6.743 3.825-15.098-.044-21.825l-23.113-40.197c-3.794-6.597-10.674-10.558-18.013-10.558zm25.44 22.11c4.268-3.54 10.597-3.037 14.256 1.172l25.171 28.956.223.263a14.81 14.81 0 0 1-.223 19.16l-25.171 28.957c-3.659 4.209-9.988 4.712-14.255 1.172l-.202-.172c-4.268-3.728-4.71-10.222-.991-14.499L110.284 90l-21.88-25.169c-3.718-4.277-3.277-10.771.99-14.5l.203-.17Z"
			/>
			<defs>
				<linearGradient
					id="portkey-logo-gradient"
					x1="-92.51"
					x2="194.256"
					y1="52.188"
					y2="216.739"
					gradientUnits="userSpaceOnUse"
				>
					<stop offset=".173" stopColor="#00a3ff" />
					<stop offset=".899" stopColor="#ff0f00" />
				</linearGradient>
			</defs>
		</svg>
	),
};

export default async function MigrationPage() {
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
						{allMigrations.map((migration) => (
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
