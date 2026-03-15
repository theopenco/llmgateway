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
			"Unlike OpenRouter, LLM Gateway offers: Full self-hosting under an AGPLv3 license – run the gateway entirely on your infra. Deeper, real-time cost & latency analytics for every request. Bring Your Own Keys for free. Flexible enterprise add-ons (dedicated shard, custom SLAs).",
	},
	{
		question: "What models do you support?",
		answer:
			"We support 210+ models across 25+ providers—including GPT-4o, Claude, Gemini, Llama, Mistral, and more. We add new releases within 48 hours of launch.",
	},
	{
		question: "What is your uptime guarantee?",
		answer:
			"Our public status page posts real-time metrics. Enterprise instances come with a 99.9% uptime SLA; self-host installations depend on your infrastructure.",
	},
	{
		question: "How much does it cost?",
		answer:
			"Credits: Pay-as-you-go with a flat 5% platform fee. BYOK: Use your own provider API keys for free. Enterprise: Custom SLA, dedicated infrastructure, and volume discounts. Self-host: Deploy free forever under AGPLv3 license.",
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
						<p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-4">
							FAQ
						</p>
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
							{/* Item 1 */}
							<AccordionItem value="item-1" className="py-5 border-border/50">
								<AccordionPrimitive.Header className="flex">
									<AccordionPrimitive.Trigger className="focus-visible:border-ring focus-visible:ring-ring/50 flex flex-1 items-center justify-between gap-4 rounded-md py-2 text-left font-display text-lg md:text-xl font-medium leading-7 transition-all outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&>svg>path:last-child]:origin-center [&>svg>path:last-child]:transition-all [&>svg>path:last-child]:duration-200 [&[data-state=open]>svg]:rotate-180 [&[data-state=open]>svg>path:last-child]:rotate-90 [&[data-state=open]>svg>path:last-child]:opacity-0 text-foreground">
										What makes LLM Gateway different from OpenRouter?
										<PlusIcon
											size={18}
											className="pointer-events-none shrink-0 opacity-60 transition-transform duration-200"
											aria-hidden="true"
										/>
									</AccordionPrimitive.Trigger>
								</AccordionPrimitive.Header>
								<AccordionContent className="overflow-hidden transition-all data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up text-base text-muted-foreground leading-relaxed pb-2">
									<div className="border-l-2 border-foreground/10 pl-4">
										<p>Unlike OpenRouter, we offer:</p>
										<ul className="list-disc pl-6 mt-2 space-y-1">
											<li>
												Full <strong>self-hosting</strong> under an AGPLv3
												license – run the gateway entirely on your infra.
											</li>
											<li>
												Deeper, real-time{" "}
												<strong>cost & latency analytics</strong> for every
												request
											</li>
											<li>
												<strong>Bring Your Own Keys</strong> – use your own
												provider API keys for free
											</li>
											<li>
												Flexible <strong>enterprise add-ons</strong> (dedicated
												shard, custom SLAs)
											</li>
										</ul>
									</div>
								</AccordionContent>
							</AccordionItem>

							{/* Item 2 */}
							<AccordionItem value="item-2" className="py-5 border-border/50">
								<AccordionPrimitive.Header className="flex">
									<AccordionPrimitive.Trigger className="focus-visible:border-ring focus-visible:ring-ring/50 flex flex-1 items-center justify-between gap-4 rounded-md py-2 text-left font-display text-lg md:text-xl font-medium leading-7 transition-all outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&>svg>path:last-child]:origin-center [&>svg>path:last-child]:transition-all [&>svg>path:last-child]:duration-200 [&[data-state=open]>svg]:rotate-180 [&[data-state=open]>svg>path:last-child]:rotate-90 [&[data-state=open]>svg>path:last-child]:opacity-0 text-foreground">
										What models do you support?
										<PlusIcon
											size={18}
											className="pointer-events-none shrink-0 opacity-60 transition-transform duration-200"
											aria-hidden="true"
										/>
									</AccordionPrimitive.Trigger>
								</AccordionPrimitive.Header>
								<AccordionContent className="overflow-hidden transition-all data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up text-base text-muted-foreground leading-relaxed pb-2">
									<div className="border-l-2 border-foreground/10 pl-4">
										We support 210+ models across 25+ providers—including
										GPT-4o, Claude, Gemini, Llama, Mistral, and more. Check the{" "}
										<Link href="/models" className="underline">
											models page
										</Link>{" "}
										for the full list. We add new releases within 48 hours of
										launch.
									</div>
								</AccordionContent>
							</AccordionItem>

							{/* Item 3 */}
							<AccordionItem value="item-3" className="py-5 border-border/50">
								<AccordionPrimitive.Header className="flex">
									<AccordionPrimitive.Trigger className="focus-visible:border-ring focus-visible:ring-ring/50 flex flex-1 items-center justify-between gap-4 rounded-md py-2 text-left font-display text-lg md:text-xl font-medium leading-7 transition-all outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&>svg>path:last-child]:origin-center [&>svg>path:last-child]:transition-all [&>svg>path:last-child]:duration-200 [&[data-state=open]>svg]:rotate-180 [&[data-state=open]>svg>path:last-child]:rotate-90 [&[data-state=open]>svg>path:last-child]:opacity-0 text-foreground">
										What is your uptime guarantee?
										<PlusIcon
											size={18}
											className="pointer-events-none shrink-0 opacity-60 transition-transform duration-200"
											aria-hidden="true"
										/>
									</AccordionPrimitive.Trigger>
								</AccordionPrimitive.Header>
								<AccordionContent className="overflow-hidden transition-all data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up text-base text-muted-foreground leading-relaxed pb-2">
									<div className="border-l-2 border-foreground/10 pl-4">
										Our public status page posts real-time metrics. Enterprise
										instances come with a <strong>99.9% uptime SLA</strong>;
										self-host installations depend on your infrastructure.
									</div>
								</AccordionContent>
							</AccordionItem>

							{/* Item 4 */}
							<AccordionItem value="item-4" className="py-5 border-border/50">
								<AccordionPrimitive.Header className="flex">
									<AccordionPrimitive.Trigger className="focus-visible:border-ring focus-visible:ring-ring/50 flex flex-1 items-center justify-between gap-4 rounded-md py-2 text-left font-display text-lg md:text-xl font-medium leading-7 transition-all outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&>svg>path:last-child]:origin-center [&>svg>path:last-child]:transition-all [&>svg>path:last-child]:duration-200 [&[data-state=open]>svg]:rotate-180 [&[data-state=open]>svg>path:last-child]:rotate-90 [&[data-state=open]>svg>path:last-child]:opacity-0 text-foreground">
										How much does it cost?
										<PlusIcon
											size={18}
											className="pointer-events-none shrink-0 opacity-60 transition-transform duration-200"
											aria-hidden="true"
										/>
									</AccordionPrimitive.Trigger>
								</AccordionPrimitive.Header>
								<AccordionContent className="overflow-hidden transition-all data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up text-base text-muted-foreground leading-relaxed pb-2">
									<div className="border-l-2 border-foreground/10 pl-4">
										<p>Our pricing is simple and transparent:</p>
										<ul className="list-disc pl-6 mt-2 space-y-1">
											<li>
												<strong>Credits – 5% fee:</strong> Pay-as-you-go credits
												to use any model with a flat 5% platform fee on
												purchases.
											</li>
											<li>
												<strong>Bring Your Own Keys – free:</strong> Use your
												own LLM provider API keys (OpenAI, Anthropic, Google,
												etc.) and pay providers directly. Usage tracking and
												analytics included at no extra cost.
											</li>
											<li>
												<strong>Enterprise:</strong> Custom SLA, dedicated
												infrastructure, bring-your-own cloud capacity, and
												volume discounts. Contact sales for a tailored quote.
											</li>
											<li>
												<strong>Self-host:</strong> Deploy the AGPLv3-licensed
												gateway on your own infrastructure—free forever.
											</li>
										</ul>
									</div>
								</AccordionContent>
							</AccordionItem>
						</Accordion>
					</div>
				</div>
			</div>
		</section>
	);
}
