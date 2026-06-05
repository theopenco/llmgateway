import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { ChatPricingPlans } from "@/components/pricing/chat-pricing-plans";
import { getUser } from "@/lib/getUser";

import { getChatPlanCreditsMultipliers } from "@llmgateway/shared";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Pricing — LLMGateway Chat",
	description:
		"Subscribe to a chat plan and get up to 3× the credits for your dollar. All frontier models in one place, billed monthly.",
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
					Three plans. Frontier models on Plus and Pro.
				</h1>
				<p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">
					Subscribe and get{" "}
					<strong>up to 3× the credits for your dollar</strong>. Credits reset
					each cycle — pay-as-you-go top-ups stay available alongside.
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
						<strong>Credits expire at month end.</strong> Each cycle you get a
						fresh allowance — unused credits don&apos;t roll over.
					</li>
					<li>
						<strong>Your pay-as-you-go balance stays.</strong> Top-ups never
						expire and act as a fallback once monthly credits are spent.
					</li>
					<li>
						<strong>Cancel anytime.</strong> Subscription stays active until the
						end of the period you already paid for.
					</li>
					<li>
						<strong>Starter excludes frontier models</strong> (Opus, GPT-5,
						Gemini 2.5 Pro, Grok 4). Plus and Pro include everything.
					</li>
				</ul>
			</section>
		</main>
	);
}
