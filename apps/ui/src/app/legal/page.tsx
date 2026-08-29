import {
	ArrowUpRight,
	Building2,
	Network,
	Scale,
	ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";

import type { LucideIcon } from "lucide-react";
import type { Metadata } from "next";

const metadataDescription =
	"Review LLM Gateway's Terms of Use, Privacy Policy, sub-processors, and AI provider legal and compliance information.";

export const metadata: Metadata = {
	title: "Legal Information & Policies",
	description: metadataDescription,
	alternates: { canonical: "/legal" },
	openGraph: {
		title: "Legal Information & Policies | LLM Gateway",
		description: metadataDescription,
		url: "https://llmgateway.io/legal",
		type: "website",
	},
};

interface LegalResource {
	title: string;
	description: string;
	href: string;
	linkLabel: string;
	icon: LucideIcon;
}

const legalResources: LegalResource[] = [
	{
		title: "Terms of Use",
		description:
			"The agreement governing access to LLM Gateway, including accounts, billing, acceptable use, and third-party AI providers.",
		href: "/legal/terms",
		linkLabel: "Read the terms",
		icon: Scale,
	},
	{
		title: "Privacy Policy",
		description:
			"How we collect, use, share, retain, and protect personal information and customer data.",
		href: "/legal/privacy",
		linkLabel: "Read the privacy policy",
		icon: ShieldCheck,
	},
	{
		title: "Provider Information",
		description:
			"Legal links, locations, data handling, retention, and compliance information for every available AI provider.",
		href: "/legal/providers",
		linkLabel: "Review provider information",
		icon: Building2,
	},
	{
		title: "Sub-processors",
		description:
			"The third parties that process personal data for our platform, including their purpose and primary processing locations.",
		href: "/legal/sub-processors",
		linkLabel: "Review sub-processors",
		icon: Network,
	},
];

export default function LegalPage() {
	return (
		<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
			<HeroRSC navbarOnly />
			<main className="container mx-auto px-4 pb-24 pt-44 md:pt-52">
				<div className="mx-auto max-w-6xl">
					<header className="max-w-3xl">
						<h1 className="font-display text-4xl font-semibold tracking-tight md:text-5xl">
							Legal information
						</h1>
						<p className="mt-5 text-lg leading-8 text-muted-foreground">
							Find the documents that govern LLM Gateway and review the policies
							of the AI providers available through our service.
						</p>
					</header>

					<section
						aria-label="Legal resources"
						className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-4"
					>
						{legalResources.map((resource) => {
							const Icon = resource.icon;

							return (
								<Link
									key={resource.href}
									href={resource.href}
									className="group flex min-h-72 flex-col rounded-2xl border bg-card p-7 transition-colors hover:border-foreground/25 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
								>
									<div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
										<Icon aria-hidden="true" className="size-5" />
									</div>
									<h2 className="mt-8 font-display text-2xl font-semibold">
										{resource.title}
									</h2>
									<p className="mt-3 text-sm leading-6 text-muted-foreground">
										{resource.description}
									</p>
									<span className="mt-auto inline-flex items-center gap-2 pt-8 text-sm font-medium text-primary">
										{resource.linkLabel}
										<ArrowUpRight
											aria-hidden="true"
											className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
										/>
									</span>
								</Link>
							);
						})}
					</section>
				</div>
			</main>
			<Footer />
		</div>
	);
}
