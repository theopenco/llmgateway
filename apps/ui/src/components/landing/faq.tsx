import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { PlusIcon } from "lucide-react";
import Link from "next/link";

import { TrackedLink } from "@/components/home/tracked-link";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
} from "@/lib/components/accordion";

import { MARKETING_STATS } from "@llmgateway/shared";

import type { ReactNode } from "react";

interface FaqEntry {
	question: string;
	answer: string;
	content?: ReactNode;
}

const modelsAnswer = `We support ${MARKETING_STATS.models} models across ${MARKETING_STATS.providers} providers—including GPT-4o, Claude, Gemini, Llama, Mistral, and more. We add new releases within 48 hours of launch.`;

const faqData: FaqEntry[] = [
	{
		question: "What makes LLM Gateway different from OpenRouter?",
		answer:
			"Unlike OpenRouter, LLM Gateway offers: Full self-hosting under an AGPLv3 license – run the gateway entirely on your infra. Deeper, real-time cost & latency analytics for every request. Bring Your Own Keys for free. Flexible enterprise add-ons (dedicated shard, custom SLAs).",
		content: (
			<>
				<p>Unlike OpenRouter, we offer:</p>
				<ul className="list-disc pl-6 mt-2 space-y-1">
					<li>
						Full <strong>self-hosting</strong> under an AGPLv3 license – run the
						gateway entirely on your infra.
					</li>
					<li>
						Deeper, real-time <strong>cost & latency analytics</strong> for
						every request
					</li>
					<li>
						<strong>Bring Your Own Keys</strong> – use your own provider API
						keys for free
					</li>
					<li>
						Flexible <strong>enterprise add-ons</strong> (dedicated shard,
						custom SLAs)
					</li>
				</ul>
			</>
		),
	},
	{
		question: "What models do you support?",
		answer: modelsAnswer,
		content: (
			<>
				{modelsAnswer} Check the{" "}
				<Link href="/models" className="underline">
					models page
				</Link>{" "}
				for the full list.
			</>
		),
	},
	{
		question: "What is your uptime guarantee?",
		answer:
			"Our public status page posts real-time metrics. Enterprise Cloud contracts include a 99.9% uptime SLA; pay-as-you-go has no SLA, and self-host installations depend on your infrastructure.",
		content: (
			<>
				Our public status page posts real-time metrics. Enterprise Cloud
				contracts include a <strong>99.9% uptime SLA</strong>; pay-as-you-go has
				no SLA, and self-host installations depend on your infrastructure.
			</>
		),
	},
	{
		question: "How much does it cost?",
		answer: `Credits: Pay-as-you-go with a flat ${MARKETING_STATS.platformFee} platform fee. Non-US issued cards incur an additional ${MARKETING_STATS.internationalCardFee} international card fee, shown in the top-up breakdown before checkout. BYOK: Use your own provider API keys for free. Enterprise: Custom SLA, dedicated infrastructure, and volume discounts. Self-host: Deploy the core gateway free under AGPLv3; enterprise features need a license. Request logs are metadata only by default; on Enterprise, full data retention is billed at ${MARKETING_STATS.dataStoragePrice} in both credits and BYOK modes.`,
		content: (
			<>
				<p>Our pricing is simple and transparent:</p>
				<ul className="list-disc pl-6 mt-2 space-y-1">
					<li>
						<strong>Credits – {MARKETING_STATS.platformFee} fee:</strong>{" "}
						Pay-as-you-go credits to use any model with a flat{" "}
						{MARKETING_STATS.platformFee} platform fee on purchases. Non-US
						issued cards incur an additional{" "}
						{MARKETING_STATS.internationalCardFee} international card fee, shown
						clearly in the top-up breakdown before checkout.
					</li>
					<li>
						<strong>Bring Your Own Keys – free:</strong> Use your own LLM
						provider API keys (OpenAI, Anthropic, Google, etc.) and pay
						providers directly. Usage tracking and analytics included at no
						extra cost.
					</li>
					<li>
						<strong>Enterprise:</strong> Custom SLA, dedicated infrastructure,
						bring-your-own cloud capacity, and volume discounts. Contact sales
						for a tailored quote.
					</li>
					<li>
						<strong>Self-host:</strong> Deploy the AGPLv3-licensed gateway on
						your own infrastructure for free. Enterprise features need a
						license.
					</li>
				</ul>
				<p className="mt-2">
					Request logs are metadata only by default. On Enterprise,{" "}
					<a
						href="https://docs.llmgateway.io/features/data-retention#storage-pricing"
						className="underline"
					>
						full data retention
					</a>{" "}
					is billed at {MARKETING_STATS.dataStoragePrice} in both credits and
					BYOK modes.
				</p>
			</>
		),
	},
	{
		question: "Will LLM Gateway pass our security review?",
		answer:
			"LLM Gateway is SOC 2 Type II compliant. The full report, a GDPR-aligned data processing agreement, and the current subprocessor list are available on request, and security questionnaires are answered by the engineers who run the gateway. Enterprise adds SAML SSO, audit logs, guardrails, provider compliance policies, and zero data retention.",
		content: (
			<>
				<p>
					LLM Gateway is SOC 2 Type II compliant. The full report, a
					GDPR-aligned data processing agreement, and the current subprocessor
					list are available on request, and security questionnaires are
					answered by the engineers who run the gateway.
				</p>
				<p className="mt-2">
					Enterprise adds{" "}
					<Link href="/enterprise/sso-saml" className="underline">
						SAML SSO
					</Link>
					,{" "}
					<Link href="/enterprise/audit-logs" className="underline">
						audit logs
					</Link>
					,{" "}
					<Link href="/enterprise/guardrails" className="underline">
						guardrails
					</Link>
					,{" "}
					<Link href="/enterprise/compliance" className="underline">
						provider compliance policies
					</Link>
					, and{" "}
					<Link href="/enterprise/zero-data-retention" className="underline">
						zero data retention
					</Link>
					.
				</p>
			</>
		),
	},
	{
		question: "How fast can a team go live on Enterprise?",
		answer:
			"Every enterprise plan starts with the 30-Day Production Pilot: production traffic live in week one, SSO, audit logs, and guardrails configured in week two, and a decision gate at day 30 with no long-term contract before it.",
		content: (
			<>
				<p>
					Every enterprise plan starts with the 30-Day Production Pilot:
					production traffic live in week one, SSO, audit logs, and guardrails
					configured in week two, and a decision gate at day 30 with no
					long-term contract before it.
				</p>
				<p className="mt-2">
					<TrackedLink
						href="/enterprise#contact"
						location="home_faq"
						cta="book_a_call"
						className="text-foreground underline underline-offset-4"
					>
						Book a call to start a pilot
					</TrackedLink>
				</p>
			</>
		),
	},
];

const faqSchema = {
	"@context": "https://schema.org",
	"@type": "FAQPage",
	mainEntity: faqData.map((item) => ({
		"@type": "Question",
		name: item.question,
		acceptedAnswer: {
			"@type": "Answer",
			text: item.answer,
		},
	})),
};

function FaqItem({ value, entry }: { value: string; entry: FaqEntry }) {
	return (
		<AccordionItem value={value} className="py-5 border-border/50">
			<AccordionPrimitive.Header className="flex">
				<AccordionPrimitive.Trigger className="focus-visible:border-ring focus-visible:ring-ring/50 flex flex-1 items-center justify-between gap-4 rounded-md py-2 text-left font-display text-lg md:text-xl font-medium leading-7 transition-all outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&>svg>path:last-child]:origin-center [&>svg>path:last-child]:transition-all [&>svg>path:last-child]:duration-200 [&[data-state=open]>svg]:rotate-180 [&[data-state=open]>svg>path:last-child]:rotate-90 [&[data-state=open]>svg>path:last-child]:opacity-0 text-foreground">
					{entry.question}
					<PlusIcon
						size={18}
						className="pointer-events-none shrink-0 opacity-60 transition-transform duration-200"
						aria-hidden="true"
					/>
				</AccordionPrimitive.Trigger>
			</AccordionPrimitive.Header>
			<AccordionContent className="overflow-hidden transition-all data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up text-base text-muted-foreground leading-relaxed pb-2">
				<div className="border-l-2 border-foreground/10 pl-4">
					{entry.content ?? entry.answer}
				</div>
			</AccordionContent>
		</AccordionItem>
	);
}

export function Faq() {
	return (
		<section className="w-full py-20 md:py-32 bg-background" id="faq">
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{
					__html: JSON.stringify(faqSchema),
				}}
			/>
			<div className="container mx-auto px-4 md:px-6">
				<div className="grid grid-cols-1 lg:grid-cols-5 gap-12 lg:gap-16">
					{/* Left column: sticky heading */}
					<div className="lg:col-span-2 lg:sticky lg:top-24 lg:self-start">
						<h2 className="font-display text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight text-foreground">
							Common questions
						</h2>
						<p className="mt-4 text-muted-foreground">
							Everything you need to know about pricing, models, and getting
							started.
						</p>
						<p className="mt-6 text-sm text-muted-foreground">
							Can't find an answer?{" "}
							<a
								href="mailto:contact@llmgateway.io"
								className="text-foreground underline underline-offset-4"
							>
								Contact us
							</a>
						</p>
					</div>

					{/* Right column: accordion */}
					<div className="lg:col-span-3">
						<Accordion
							type="single"
							collapsible
							className="w-full"
							defaultValue="item-1"
						>
							{faqData.map((entry, index) => (
								<FaqItem
									key={entry.question}
									value={`item-${index + 1}`}
									entry={entry}
								/>
							))}
						</Accordion>
					</div>
				</div>
			</div>
		</section>
	);
}
