import { Building2, Github, Mail, MessageCircle, Users } from "lucide-react";
import Link from "next/link";

import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { JsonLd } from "@/components/seo/json-ld";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Contact",
	description:
		"Contact the LLM Gateway team: email support, Discord community, GitHub issues, and enterprise sales. Company details and postal address included.",
	alternates: { canonical: "/contact" },
	openGraph: {
		title: "Contact LLM Gateway",
		description:
			"Contact the LLM Gateway team: email support, Discord community, GitHub issues, and enterprise sales.",
		url: "https://llmgateway.io/contact",
		type: "website",
	},
};

const channels = [
	{
		icon: Mail,
		title: "Email",
		description:
			"Product questions, billing, account help, security reports, and anything else — we read everything.",
		linkLabel: "contact@llmgateway.io",
		href: "mailto:contact@llmgateway.io",
	},
	{
		icon: MessageCircle,
		title: "Discord community",
		description:
			"The fastest way to get help from the team and other developers running LLM Gateway in production.",
		linkLabel: "Join the Discord",
		href: "/discord",
	},
	{
		icon: Github,
		title: "GitHub",
		description:
			"Found a bug or want a feature? The entire platform is open source — issues and pull requests are welcome.",
		linkLabel: "github.com/theopenco/llmgateway",
		href: "https://github.com/theopenco/llmgateway",
	},
	{
		icon: Users,
		title: "Enterprise sales",
		description:
			"Volume pricing, SSO, custom data retention, or self-hosted support — tell us about your team and use case.",
		linkLabel: "Talk to sales",
		href: "/enterprise",
	},
];

const contactPageSchema = {
	"@context": "https://schema.org",
	"@type": "ContactPage",
	name: "Contact LLM Gateway",
	url: "https://llmgateway.io/contact",
	about: {
		"@type": "Organization",
		name: "LLM Gateway",
		legalName: "Polar Lights LLC",
		email: "contact@llmgateway.io",
		url: "https://llmgateway.io",
		address: {
			"@type": "PostalAddress",
			streetAddress: "16192 Coastal Highway",
			addressLocality: "Lewes",
			addressRegion: "DE",
			postalCode: "19958",
			addressCountry: "US",
		},
	},
};

export default function ContactPage() {
	return (
		<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
			<JsonLd data={contactPageSchema} />
			<Navbar />
			<main>
				<section className="relative overflow-hidden">
					<div className="mx-auto max-w-5xl px-6 pt-24 pb-12 md:pt-36 md:pb-16 text-center">
						<h1 className="text-4xl md:text-6xl font-bold tracking-tight text-balance">
							Contact us
						</h1>
						<p className="mx-auto mt-6 max-w-2xl text-base md:text-lg text-muted-foreground">
							Whether you&apos;re debugging your first request or routing
							billions of tokens, there&apos;s a direct line to the team behind
							LLM Gateway. Pick whichever channel suits you — email gets a reply
							from a human, usually within one business day.
						</p>
					</div>
				</section>

				<section className="w-full py-8 md:py-12 bg-background">
					<div className="container px-4 md:px-6 max-w-5xl mx-auto">
						<div className="grid gap-6 sm:grid-cols-2">
							{channels.map(({ icon: Icon, title, description, ...link }) => (
								<div
									key={title}
									className="rounded-xl border border-border/60 bg-card p-6"
								>
									<Icon className="h-6 w-6 text-primary" aria-hidden="true" />
									<h2 className="mt-4 text-lg font-semibold text-foreground">
										{title}
									</h2>
									<p className="mt-2 text-sm text-muted-foreground">
										{description}
									</p>
									{link.href === "/enterprise" ? (
										<Link
											href="/enterprise"
											className="mt-4 inline-block text-sm font-medium text-primary underline underline-offset-4 hover:text-primary/80"
										>
											{link.linkLabel}
										</Link>
									) : (
										<a
											href={link.href}
											className="mt-4 inline-block text-sm font-medium text-primary underline underline-offset-4 hover:text-primary/80"
										>
											{link.linkLabel}
										</a>
									)}
								</div>
							))}
						</div>
					</div>
				</section>

				<section className="w-full py-12 md:py-16 bg-background">
					<div className="container px-4 md:px-6 max-w-3xl mx-auto">
						<div className="rounded-xl border border-border/60 bg-card p-6 md:p-8">
							<div className="flex items-start gap-4">
								<Building2
									className="h-6 w-6 shrink-0 text-primary"
									aria-hidden="true"
								/>
								<div>
									<h2 className="text-lg font-semibold text-foreground">
										Company
									</h2>
									<p className="mt-2 text-sm leading-relaxed text-muted-foreground">
										LLM Gateway is operated by Polar Lights LLC
										<br />
										16192 Coastal Highway
										<br />
										Lewes, DE 19958
										<br />
										United States
									</p>
									<p className="mt-4 text-sm text-muted-foreground">
										Legal documents:{" "}
										<Link
											href="/legal/terms"
											className="text-foreground underline underline-offset-4"
										>
											Terms of Use
										</Link>{" "}
										·{" "}
										<Link
											href="/legal/privacy"
											className="text-foreground underline underline-offset-4"
										>
											Privacy Policy
										</Link>
									</p>
								</div>
							</div>
						</div>
					</div>
				</section>
			</main>
			<Footer />
		</div>
	);
}
