"use client";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { PlusIcon } from "lucide-react";
import Link from "next/link";

import {
	Accordion,
	AccordionContent,
	AccordionItem,
} from "@/lib/components/accordion";

const faqData = [
	{
		question: "What makes LLM Gateway different from OpenRouter?",
		answer:
			"Unlike OpenRouter, LLM Gateway offers: Full self-hosting under an AGPLv3 license – run the gateway entirely on your infra. Deeper, real-time cost & latency analytics for every request. Bring Your Own Keys with just 1% tracking fee. Flexible enterprise add-ons (dedicated shard, custom SLAs).",
	},
	{
		question: "What models do you support?",
		answer:
			"We support 180+ models across 60+ providers—including GPT-4o, Claude, Gemini, Llama, Mistral, and more. We add new releases within 48 hours of launch.",
	},
	{
		question: "What is your uptime guarantee?",
		answer:
			"Our public status page posts real-time metrics. Enterprise instances come with a 99.9% uptime SLA; self-host installations depend on your infrastructure.",
	},
	{
		question: "How much does it cost?",
		answer:
			"Credits: Pay-as-you-go with a flat 5% platform fee. BYOK: Use your own provider API keys with just 1% tracking fee. Enterprise: Custom SLA, dedicated infrastructure, and volume discounts. Self-host: Deploy free forever under AGPLv3 license.",
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

export function Faq() {
	return (
		<section
			className="w-full py-12 md:py-24 lg:py-32 bg-white dark:bg-black"
			id="faq"
		>
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{
					__html: JSON.stringify(faqSchema),
				}}
			/>
			<div className="container mx-auto px-4 md:px-6">
				{/* Heading */}
				<div className="flex flex-col items-center justify-center space-y-4 text-center">
					<div className="space-y-2">
						<h2 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl dark:text-white">
							Frequently Asked Questions
						</h2>
						<p className="max-w-[700px] text-gray-500 md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed dark:text-gray-400">
							Everything you need to know about pricing, models, and getting
							started.
						</p>
					</div>
				</div>

				{/* Accordion */}
				<div className="mx-auto max-w-3xl mt-8">
					<Accordion
						type="single"
						collapsible
						className="w-full"
						defaultValue="item-1"
					>
						{/* Item 1 – differentiation */}
						<AccordionItem value="item-1" className="py-2">
							<AccordionPrimitive.Header className="flex">
								<AccordionPrimitive.Trigger className="focus-visible:border-ring focus-visible:ring-ring/50 flex flex-1 items-center justify-between gap-4 rounded-md py-2 text-left text-lg font-medium leading-6 transition-all outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&>svg>path:last-child]:origin-center [&>svg>path:last-child]:transition-all [&>svg>path:last-child]:duration-200 [&[data-state=open]>svg]:rotate-180 [&[data-state=open]>svg>path:last-child]:rotate-90 [&[data-state=open]>svg>path:last-child]:opacity-0 dark:text-gray-200">
									What makes LLM Gateway different from OpenRouter?
									<PlusIcon
										size={18}
										className="pointer-events-none shrink-0 opacity-60 transition-transform duration-200"
										aria-hidden="true"
									/>
								</AccordionPrimitive.Trigger>
							</AccordionPrimitive.Header>
							<AccordionContent className="overflow-hidden transition-all data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up text-gray-500 dark:text-gray-400 pb-2">
								<p>Unlike OpenRouter, we offer:</p>
								<ul className="list-disc pl-6 mt-2 space-y-1">
									<li>
										Full <strong>self‑hosting</strong> under an AGPLv3 license –
										run the gateway entirely on your infra.
									</li>
									<li>
										Deeper, real‑time <strong>cost & latency analytics</strong>{" "}
										for every request
									</li>
									<li>
										<strong>Bring Your Own Keys</strong> – use your own provider
										API keys with just 1% tracking fee
									</li>
									<li>
										Flexible <strong>enterprise add‑ons</strong> (dedicated
										shard, custom SLAs)
									</li>
								</ul>
							</AccordionContent>
						</AccordionItem>

						{/* Item 2 – models */}
						<AccordionItem value="item-2" className="py-2">
							<AccordionPrimitive.Header className="flex">
								<AccordionPrimitive.Trigger className="focus-visible:border-ring focus-visible:ring-ring/50 flex flex-1 items-center justify-between gap-4 rounded-md py-2 text-left text-lg font-medium leading-6 transition-all outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&>svg>path:last-child]:origin-center [&>svg>path:last-child]:transition-all [&>svg>path:last-child]:duration-200 [&[data-state=open]>svg]:rotate-180 [&[data-state=open]>svg>path:last-child]:rotate-90 [&[data-state=open]>svg>path:last-child]:opacity-0 dark:text-gray-200">
									What models do you support?
									<PlusIcon
										size={18}
										className="pointer-events-none shrink-0 opacity-60 transition-transform duration-200"
										aria-hidden="true"
									/>
								</AccordionPrimitive.Trigger>
							</AccordionPrimitive.Header>
							<AccordionContent className="overflow-hidden transition-all data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up text-gray-500 dark:text-gray-400 pb-2">
								We support 180+ models across 60+ providers—including GPT-4o,
								Claude, Gemini, Llama, Mistral, and more. Check the{" "}
								<Link href="/models" className="underline">
									models page
								</Link>{" "}
								for the full list. We add new releases within 48 hours of
								launch.
							</AccordionContent>
						</AccordionItem>

						{/* Item 3 – uptime */}
						<AccordionItem value="item-3" className="py-2">
							<AccordionPrimitive.Header className="flex">
								<AccordionPrimitive.Trigger className="focus-visible:border-ring focus-visible:ring-ring/50 flex flex-1 items-center justify-between gap-4 rounded-md py-2 text-left text-lg font-medium leading-6 transition-all outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&>svg>path:last-child]:origin-center [&>svg>path:last-child]:transition-all [&>svg>path:last-child]:duration-200 [&[data-state=open]>svg]:rotate-180 [&[data-state=open]>svg>path:last-child]:rotate-90 [&[data-state=open]>svg>path:last-child]:opacity-0 dark:text-gray-200">
									What is your uptime guarantee?
									<PlusIcon
										size={18}
										className="pointer-events-none shrink-0 opacity-60 transition-transform duration-200"
										aria-hidden="true"
									/>
								</AccordionPrimitive.Trigger>
							</AccordionPrimitive.Header>
							<AccordionContent className="overflow-hidden transition-all data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up text-gray-500 dark:text-gray-400 pb-2">
								Our public status page posts real‑time metrics. Enterprise
								instances come with a <strong>99.9 % uptime SLA</strong>;
								self‑host installations depend on your infrastructure.
							</AccordionContent>
						</AccordionItem>

						{/* Item 4 – pricing */}
						<AccordionItem value="item-4" className="py-2">
							<AccordionPrimitive.Header className="flex">
								<AccordionPrimitive.Trigger className="focus-visible:border-ring focus-visible:ring-ring/50 flex flex-1 items-center justify-between gap-4 rounded-md py-2 text-left text-lg font-medium leading-6 transition-all outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&>svg>path:last-child]:origin-center [&>svg>path:last-child]:transition-all [&>svg>path:last-child]:duration-200 [&[data-state=open]>svg]:rotate-180 [&[data-state=open]>svg>path:last-child]:rotate-90 [&[data-state=open]>svg>path:last-child]:opacity-0 dark:text-gray-200">
									How much does it cost?
									<PlusIcon
										size={18}
										className="pointer-events-none shrink-0 opacity-60 transition-transform duration-200"
										aria-hidden="true"
									/>
								</AccordionPrimitive.Trigger>
							</AccordionPrimitive.Header>
							<AccordionContent className="overflow-hidden transition-all data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up text-gray-500 dark:text-gray-400 pb-2">
								<p>Our pricing is simple and transparent:</p>
								<ul className="list-disc pl-6 mt-2 space-y-1">
									<li>
										<strong>Credits – 5% fee:</strong> Pay‑as‑you‑go credits to
										use any model with a flat 5% platform fee on purchases.
									</li>
									<li>
										<strong>Bring Your Own Keys – 1% fee:</strong> Use your own
										LLM provider API keys (OpenAI, Anthropic, Google, etc.) and
										pay providers directly. We charge just 1% to track usage and
										provide analytics.
									</li>
									<li>
										<strong>Enterprise:</strong> Custom SLA, dedicated
										infrastructure, bring-your-own cloud capacity, and volume
										discounts. Contact sales for a tailored quote.
									</li>
									<li>
										<strong>Self‑host:</strong> Deploy the AGPLv3‑licensed
										gateway on your own infrastructure—free forever.
									</li>
								</ul>
							</AccordionContent>
						</AccordionItem>
					</Accordion>
				</div>
			</div>
		</section>
	);
}
