import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { ChatBillingHistory } from "@/components/pricing/chat-billing-history";
import { ChatPricingPlans } from "@/components/pricing/chat-pricing-plans";
import { getUser } from "@/lib/getUser";

import { getChatPlanCreditsMultipliers } from "@llmgateway/shared";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Pricing — LLMGateway Chat",
	description:
		"Every frontier model in one subscription — Claude Opus, GPT-5, Gemini and Grok, from $19/mo. Start on fast models from $9/mo. Replaces ChatGPT Plus, Claude Pro and Gemini Advanced — with more usage than you pay for.",
	alternates: {
		canonical: "/pricing",
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
				<h1 className="text-3xl font-bold tracking-tight sm:text-5xl">
					Every frontier model. One subscription.
				</h1>
				<p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">
					Claude Opus, GPT-5, Gemini and Grok in one place — for less than a
					single ChatGPT Plus subscription. Start on fast models from $9, or
					unlock every frontier flagship from $19. Every plan gives you{" "}
					<strong>more usage than you pay for</strong>.
				</p>
			</header>

			<ChatPricingPlans
				isAuthenticated={Boolean(user)}
				creditsMultipliers={getChatPlanCreditsMultipliers()}
			/>

			<section className="mx-auto mt-16 max-w-3xl text-sm text-muted-foreground">
				<h2 className="mb-3 text-base font-semibold text-foreground">
					How it works
				</h2>
				<ul className="space-y-2">
					<li>
						<strong>Fresh allowance every cycle.</strong> Your full credit
						allowance refills at the start of each billing cycle, and any
						unspent credits don&apos;t roll over.
					</li>
					<li>
						<strong>7-day money-back guarantee.</strong> If you&apos;ve barely
						used your plan, email us within 7 days for a full refund.
					</li>
					<li>
						<strong>Cancel anytime.</strong> Subscription stays active until the
						end of the period you already paid for.
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
