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
			fill="currentColor"
			fillRule="evenodd"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
			className="h-8 w-8"
		>
			<path d="M19.245 5.364c1.322 1.36 1.877 3.216 2.11 5.817.622 0 1.2.135 1.592.654l.73.964c.21.278.323.61.323.955v2.62c0 .339-.173.669-.453.868C20.239 19.602 16.157 21.5 12 21.5c-4.6 0-9.205-2.583-11.547-4.258-.28-.2-.452-.53-.453-.868v-2.62c0-.345.113-.679.321-.956l.73-.963c.392-.517.974-.654 1.593-.654l.029-.297c.25-2.446.81-4.213 2.082-5.52 2.461-2.54 5.71-2.851 7.146-2.864h.198c1.436.013 4.685.323 7.146 2.864m-7.244 4.328c-.284 0-.613.016-.962.05-.123.447-.305.85-.57 1.108-1.05 1.023-2.316 1.18-2.994 1.18-.638 0-1.306-.13-1.851-.464-.516.165-1.012.403-1.044.996a65.882 65.882 0 0 0-.063 2.884l-.002.48c-.002.563-.005 1.126-.013 1.69.002.326.204.63.51.765 2.482 1.102 4.83 1.657 6.99 1.657 2.156 0 4.504-.555 6.985-1.657a.854.854 0 0 0 .51-.766c.03-1.682.006-3.372-.076-5.053-.031-.596-.528-.83-1.046-.996-.546.333-1.212.464-1.85.464-.677 0-1.942-.157-2.993-1.18-.266-.258-.447-.661-.57-1.108-.32-.032-.64-.049-.96-.05zm-2.525 4.013c.539 0 .976.426.976.95v1.753c0 .525-.437.95-.976.95a.964.964 0 0 1-.976-.95v-1.752c0-.525.437-.951.976-.951m5 0c.539 0 .976.426.976.95v1.753c0 .525-.437.95-.976.95a.964.964 0 0 1-.976-.95v-1.752c0-.525.437-.951.976-.951M7.635 5.087c-1.05.102-1.935.438-2.385.906-.975 1.037-.765 3.668-.21 4.224.405.394 1.17.657 1.995.657h.09c.649-.013 1.785-.176 2.73-1.11.435-.41.705-1.433.675-2.47-.03-.834-.27-1.52-.63-1.813-.39-.336-1.275-.482-2.265-.394m6.465.394c-.36.292-.6.98-.63 1.813-.03 1.037.24 2.06.675 2.47.968.957 2.136 1.104 2.776 1.11h.044c.825 0 1.59-.263 1.995-.657.555-.556.765-3.187-.21-4.224-.45-.468-1.335-.804-2.385-.906-.99-.088-1.875.058-2.265.394M12 7.615c-.24 0-.525.015-.84.044.03.16.045.336.06.526l-.001.159a2.94 2.94 0 0 1-.014.25c.225-.022.425-.027.612-.028h.366c.187 0 .387.006.612.028-.015-.146-.015-.277-.015-.409.015-.19.03-.365.06-.526a9.29 9.29 0 0 0-.84-.044" />
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
