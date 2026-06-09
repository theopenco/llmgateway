import {
	BadgeCheck,
	Ban,
	DatabaseZap,
	FileText,
	Info,
	KeyRound,
	ListChecks,
	Scale,
	ShieldCheck,
	UserX,
	Wallet,
} from "lucide-react";
import Link from "next/link";

import { Card, CardContent } from "@/lib/components/card";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface SummaryCard {
	icon: LucideIcon;
	title: string;
	body: ReactNode;
}

const providersLink = (
	<Link
		href="/providers"
		className="text-primary hover:text-primary/80 underline underline-offset-4"
	>
		Providers page
	</Link>
);

const privacyCards: SummaryCard[] = [
	{
		icon: DatabaseZap,
		title: "Only metadata is logged by default",
		body: (
			<>
				Out of the box we store usage metadata only — tokens, cost, latency and
				which provider was used — never the content of your prompts or
				responses. You can optionally turn on full request retention under{" "}
				<span className="text-foreground font-medium">Settings → Policies</span>{" "}
				if you want it.
			</>
		),
	},
	{
		icon: UserX,
		title: "AI requests are sent anonymously",
		body: (
			<>
				When we route a request to a provider, it is forwarded without any link
				to your LLM Gateway account. Providers receive the request on its own
				and cannot connect it back to your identity.
			</>
		),
	},
	{
		icon: ShieldCheck,
		title: "We never sell your data",
		body: (
			<>
				Your personal information is never sold. Data is shared only with a
				small set of vetted sub-processors (Stripe, Google Cloud, Resend) and
				the AI provider you choose to route to.
			</>
		),
	},
	{
		icon: FileText,
		title: "Provider terms are transparent",
		body: (
			<>
				Each provider&apos;s data retention timeframe and whether your data is
				used for AI training is listed on the {providersLink} and on every
				individual provider detail page.
			</>
		),
	},
	{
		icon: BadgeCheck,
		title: "You stay in control",
		body: (
			<>
				You can access, export or delete your data at any time. Billing records
				are kept for 10 years where tax and accounting law requires it.
			</>
		),
	},
	{
		icon: KeyRound,
		title: "We don’t store payment details",
		body: (
			<>
				Payments are handled securely by Stripe. We never see or store your
				credit card information.
			</>
		),
	},
];

const termsCards: SummaryCard[] = [
	{
		icon: Info,
		title: "What LLM Gateway is",
		body: (
			<>
				We are a router and analytics layer in front of many AI providers. We
				pass your requests through and report on them — we don&apos;t control or
				guarantee the providers&apos; outputs.
			</>
		),
	},
	{
		icon: Wallet,
		title: "Free plan & pay-as-you-go credits",
		body: (
			<>
				There&apos;s a free plan with generous limits. You can buy credits that
				are consumed as you make requests. Credits are non-refundable except
				where the law requires otherwise.
			</>
		),
	},
	{
		icon: FileText,
		title: "You own your data and prompts",
		body: (
			<>
				Your prompts and data stay yours. You grant us a limited license to
				process them only to provide the Service.
			</>
		),
	},
	{
		icon: Scale,
		title: "Provider terms also apply",
		body: (
			<>
				Using a model means you also agree to that provider&apos;s terms. Their
				policies and data handling are listed on the {providersLink}.
			</>
		),
	},
	{
		icon: Ban,
		title: "Fair use",
		body: (
			<>
				No illegal or harmful use, no circumventing rate limits or auth.
				Accounts abusing the Service may be suspended or terminated.
			</>
		),
	},
	{
		icon: ListChecks,
		title: "Provided “as is”",
		body: (
			<>
				The Service and AI outputs come without warranties and our liability is
				limited. Use of AI outputs is at your own discretion and risk.
			</>
		),
	},
];

const summaries: Record<string, { heading: string; cards: SummaryCard[] }> = {
	privacy: { heading: "Privacy in plain English", cards: privacyCards },
	terms: { heading: "Terms in plain English", cards: termsCards },
};

export function LegalSummary({ slug }: { slug: string }) {
	const summary = summaries[slug];

	if (!summary) {
		return null;
	}

	return (
		<section className="mb-12 not-prose">
			<div className="mb-6">
				<h2 className="text-2xl md:text-3xl font-semibold text-foreground mb-2">
					{summary.heading}
				</h2>
				<p className="text-sm text-muted-foreground">
					A human-readable summary of the key points. This overview is for
					convenience only and is{" "}
					<span className="text-foreground font-medium">
						not legally binding
					</span>
					— the full text below is what governs.
				</p>
			</div>
			<div className="grid gap-4 sm:grid-cols-2">
				{summary.cards.map((card) => {
					const Icon = card.icon;
					return (
						<Card key={card.title} className="gap-3 py-5">
							<CardContent className="flex gap-3">
								<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
									<Icon className="h-5 w-5" />
								</div>
								<div className="space-y-1">
									<h3 className="font-semibold leading-snug text-foreground">
										{card.title}
									</h3>
									<p className="text-sm leading-6 text-muted-foreground">
										{card.body}
									</p>
								</div>
							</CardContent>
						</Card>
					);
				})}
			</div>
		</section>
	);
}
