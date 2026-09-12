import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { ChatBillingHistory } from "@/components/pricing/chat-billing-history";
import { ChatPricingPlans } from "@/components/pricing/chat-pricing-plans";
import { getUser } from "@/lib/getUser";

import {
	getChatPlanCreditsMultipliers,
	SELF_REFUND_USAGE_PERCENT,
	SELF_REFUND_WINDOW_DAYS,
} from "@llmgateway/shared";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Membership Pricing",
	description:
		"Every frontier model in one membership — Claude Opus, GPT-5, Gemini and Grok from $19/mo, fast models from $9/mo. Replaces ChatGPT Plus, Claude Pro and Gemini Advanced.",
	alternates: {
		canonical: "/pricing",
	},
	openGraph: {
		title: "Lounge Membership Pricing — Every Frontier Model, One Plan",
		description:
			"Claude Opus, GPT-5, Gemini and Grok from $19/mo, fast models from $9/mo. Replaces ChatGPT Plus, Claude Pro and Gemini Advanced.",
		type: "website",
		url: "https://lounge.llmgateway.io/pricing",
	},
};

export default async function PricingPage() {
	const user = await getUser();

	return (
		<main className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
			<Link
				href="/"
				className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
			>
				<ArrowLeft className="h-4 w-4" />
				Back to chat
			</Link>

			<header className="mb-12 text-center">
				<p className="mb-4 flex items-center justify-center gap-3 text-[11px] font-semibold uppercase tracking-[0.28em] text-lounge-gold">
					<span aria-hidden className="h-px w-8 bg-lounge-gold/50" />
					The Lounge · Membership
					<span aria-hidden className="h-px w-8 bg-lounge-gold/50" />
				</p>
				<h1 className="font-display text-4xl font-semibold tracking-tight sm:text-6xl">
					Every frontier model.
					<br />
					One membership.
				</h1>
				<p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground sm:text-lg">
					Claude Opus, GPT-5, Gemini and Grok — all waiting in one place, for
					less than a single ChatGPT Plus subscription. Take a seat with fast
					models from $9, or unlock every frontier flagship from $19. Every
					membership gives you <strong>more usage than you pay for</strong>.
				</p>
			</header>

			<ChatPricingPlans
				isAuthenticated={Boolean(user)}
				creditsMultipliers={getChatPlanCreditsMultipliers()}
			/>

			<section className="mx-auto mt-16 max-w-3xl text-sm text-muted-foreground">
				<h2 className="mb-3 font-display text-lg font-semibold text-foreground">
					How membership works
				</h2>
				<ul className="space-y-2">
					<li>
						<strong>{"Fresh allowance every cycle. "}</strong>Your full credit
						allowance refills at the start of each billing cycle, and any
						unspent credits don&apos;t roll over.
					</li>
					<li>
						<strong>
							{`${SELF_REFUND_WINDOW_DAYS}-day money-back guarantee. `}
						</strong>
						If you&apos;ve used less than {SELF_REFUND_USAGE_PERCENT}% of your
						allowance, refund yourself from your billing history below — a full
						refund, no email needed.
					</li>
					<li>
						<strong>{"Cancel anytime. "}</strong>Your membership stays active
						until the end of the period you already paid for.
					</li>
					<li>
						<strong>Starter covers the fast models</strong> (Claude Sonnet,
						Haiku, Gemini Flash and more). Plus and Pro add the frontier
						flagships — Opus, GPT-5, Gemini Pro and Grok 4.
					</li>
				</ul>
			</section>

			{user && <ChatBillingHistory />}
		</main>
	);
}
