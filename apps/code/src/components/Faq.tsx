"use client";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { PlusIcon } from "lucide-react";
import Link from "next/link";

import {
	Accordion,
	AccordionContent,
	AccordionItem,
} from "@/components/ui/accordion";

const faqData = [
	{
		question: "How much usage do I get on each plan?",
		answer:
			"Every plan includes a fixed monthly usage allowance, calculated at standard provider rates. Lite ($29/mo) includes $87 in model usage, Pro ($79/mo) includes $237, and Max ($179/mo) includes $537 — roughly 3× the subscription price.",
	},
	{
		question: "How is usage calculated?",
		answer:
			"Usage is metered at each provider's published per-token rate (input, output, and cached tokens). You can see the dollar value of every request in your dashboard in real time.",
	},
	{
		question: "What happens if I hit my monthly limit?",
		answer:
			"Requests pause until your allowance resets at the start of the next billing cycle. You can upgrade to a higher tier at any time for an immediate, prorated boost to your available usage.",
	},
	{
		question: "Can I change plans anytime?",
		answer:
			"Yes. Upgrade or downgrade whenever you like — changes are prorated and take effect immediately. There's no lock-in and no cancellation fee.",
	},
	{
		question: "Which tools and SDKs work with DevPass?",
		answer:
			"Anything that speaks the OpenAI or Anthropic API — Claude Code, SoulForge, Cursor, Cline, Continue, Aider, the OpenAI and Anthropic SDKs, and more. Set two environment variables and you're in.",
	},
	{
		question: "Are all 200+ models included on every plan?",
		answer:
			"Yes. Every plan includes the full catalog — Claude, GPT-5, Gemini, Llama, Qwen, and the rest. Plans differ only in the size of your monthly usage allowance.",
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
							Everything you need to know about usage limits, plans, and getting
							started with DevPass.
						</p>
						<p className="mt-6 text-sm text-muted-foreground">
							Can&apos;t find an answer?{" "}
							<Link
								href="mailto:contact@llmgateway.io"
								className="text-foreground underline underline-offset-4"
							>
								Contact us
							</Link>
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
							{/* Item 1 — plan usage limits */}
							<AccordionItem value="item-1" className="py-5 border-border/50">
								<AccordionPrimitive.Header className="flex">
									<AccordionPrimitive.Trigger className="focus-visible:border-ring focus-visible:ring-ring/50 flex flex-1 items-center justify-between gap-4 rounded-md py-2 text-left font-display text-lg md:text-xl font-medium leading-7 transition-all outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&>svg>path:last-child]:origin-center [&>svg>path:last-child]:transition-all [&>svg>path:last-child]:duration-200 [&[data-state=open]>svg]:rotate-180 [&[data-state=open]>svg>path:last-child]:rotate-90 [&[data-state=open]>svg>path:last-child]:opacity-0 text-foreground">
										How much usage do I get on each plan?
										<PlusIcon
											size={18}
											className="pointer-events-none shrink-0 opacity-60 transition-transform duration-200"
											aria-hidden="true"
										/>
									</AccordionPrimitive.Trigger>
								</AccordionPrimitive.Header>
								<AccordionContent className="overflow-hidden transition-all data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up text-base text-muted-foreground leading-relaxed pb-2">
									<div className="border-l-2 border-foreground/10 pl-4">
										<p>
											Every plan includes a fixed monthly usage allowance,
											calculated at standard provider rates:
										</p>
										<ul className="list-disc pl-6 mt-2 space-y-1">
											<li>
												<strong>Lite — $29/mo:</strong> $87 in monthly model
												usage
											</li>
											<li>
												<strong>Pro — $79/mo:</strong> $237 in monthly model
												usage
											</li>
											<li>
												<strong>Max — $179/mo:</strong> $537 in monthly model
												usage
											</li>
										</ul>
										<p className="mt-3">
											That&apos;s roughly 3× the subscription price —
											effectively model access at a deep discount compared to
											paying providers directly.
										</p>
									</div>
								</AccordionContent>
							</AccordionItem>

							{/* Item 2 — usage calculation */}
							<AccordionItem value="item-2" className="py-5 border-border/50">
								<AccordionPrimitive.Header className="flex">
									<AccordionPrimitive.Trigger className="focus-visible:border-ring focus-visible:ring-ring/50 flex flex-1 items-center justify-between gap-4 rounded-md py-2 text-left font-display text-lg md:text-xl font-medium leading-7 transition-all outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&>svg>path:last-child]:origin-center [&>svg>path:last-child]:transition-all [&>svg>path:last-child]:duration-200 [&[data-state=open]>svg]:rotate-180 [&[data-state=open]>svg>path:last-child]:rotate-90 [&[data-state=open]>svg>path:last-child]:opacity-0 text-foreground">
										How is usage calculated?
										<PlusIcon
											size={18}
											className="pointer-events-none shrink-0 opacity-60 transition-transform duration-200"
											aria-hidden="true"
										/>
									</AccordionPrimitive.Trigger>
								</AccordionPrimitive.Header>
								<AccordionContent className="overflow-hidden transition-all data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up text-base text-muted-foreground leading-relaxed pb-2">
									<div className="border-l-2 border-foreground/10 pl-4">
										Usage is metered at each provider&apos;s published per-token
										rate (input, output, and cached tokens). You can see the
										dollar value of every request in your dashboard in real
										time.
									</div>
								</AccordionContent>
							</AccordionItem>

							{/* Item 3 — hitting the limit */}
							<AccordionItem value="item-3" className="py-5 border-border/50">
								<AccordionPrimitive.Header className="flex">
									<AccordionPrimitive.Trigger className="focus-visible:border-ring focus-visible:ring-ring/50 flex flex-1 items-center justify-between gap-4 rounded-md py-2 text-left font-display text-lg md:text-xl font-medium leading-7 transition-all outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&>svg>path:last-child]:origin-center [&>svg>path:last-child]:transition-all [&>svg>path:last-child]:duration-200 [&[data-state=open]>svg]:rotate-180 [&[data-state=open]>svg>path:last-child]:rotate-90 [&[data-state=open]>svg>path:last-child]:opacity-0 text-foreground">
										What happens if I hit my monthly limit?
										<PlusIcon
											size={18}
											className="pointer-events-none shrink-0 opacity-60 transition-transform duration-200"
											aria-hidden="true"
										/>
									</AccordionPrimitive.Trigger>
								</AccordionPrimitive.Header>
								<AccordionContent className="overflow-hidden transition-all data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up text-base text-muted-foreground leading-relaxed pb-2">
									<div className="border-l-2 border-foreground/10 pl-4">
										Requests pause until your allowance resets at the start of
										the next billing cycle. You can{" "}
										<strong>upgrade to a higher tier at any time</strong> for an
										immediate, prorated boost to your available usage.
									</div>
								</AccordionContent>
							</AccordionItem>

							{/* Item 4 — change plans */}
							<AccordionItem value="item-4" className="py-5 border-border/50">
								<AccordionPrimitive.Header className="flex">
									<AccordionPrimitive.Trigger className="focus-visible:border-ring focus-visible:ring-ring/50 flex flex-1 items-center justify-between gap-4 rounded-md py-2 text-left font-display text-lg md:text-xl font-medium leading-7 transition-all outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&>svg>path:last-child]:origin-center [&>svg>path:last-child]:transition-all [&>svg>path:last-child]:duration-200 [&[data-state=open]>svg]:rotate-180 [&[data-state=open]>svg>path:last-child]:rotate-90 [&[data-state=open]>svg>path:last-child]:opacity-0 text-foreground">
										Can I change plans anytime?
										<PlusIcon
											size={18}
											className="pointer-events-none shrink-0 opacity-60 transition-transform duration-200"
											aria-hidden="true"
										/>
									</AccordionPrimitive.Trigger>
								</AccordionPrimitive.Header>
								<AccordionContent className="overflow-hidden transition-all data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up text-base text-muted-foreground leading-relaxed pb-2">
									<div className="border-l-2 border-foreground/10 pl-4">
										Yes. Upgrade or downgrade whenever you like — changes are
										prorated and take effect immediately. There&apos;s no
										lock-in and no cancellation fee.
									</div>
								</AccordionContent>
							</AccordionItem>

							{/* Item 5 — compatible tools */}
							<AccordionItem value="item-5" className="py-5 border-border/50">
								<AccordionPrimitive.Header className="flex">
									<AccordionPrimitive.Trigger className="focus-visible:border-ring focus-visible:ring-ring/50 flex flex-1 items-center justify-between gap-4 rounded-md py-2 text-left font-display text-lg md:text-xl font-medium leading-7 transition-all outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&>svg>path:last-child]:origin-center [&>svg>path:last-child]:transition-all [&>svg>path:last-child]:duration-200 [&[data-state=open]>svg]:rotate-180 [&[data-state=open]>svg>path:last-child]:rotate-90 [&[data-state=open]>svg>path:last-child]:opacity-0 text-foreground">
										Which tools and SDKs work with DevPass?
										<PlusIcon
											size={18}
											className="pointer-events-none shrink-0 opacity-60 transition-transform duration-200"
											aria-hidden="true"
										/>
									</AccordionPrimitive.Trigger>
								</AccordionPrimitive.Header>
								<AccordionContent className="overflow-hidden transition-all data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up text-base text-muted-foreground leading-relaxed pb-2">
									<div className="border-l-2 border-foreground/10 pl-4">
										Anything that speaks the OpenAI or Anthropic API — Claude
										Code, SoulForge, Cursor, Cline, Continue, Aider, the OpenAI
										and Anthropic SDKs, and more. Set two environment variables
										and you&apos;re in.
									</div>
								</AccordionContent>
							</AccordionItem>

							{/* Item 6 — all models included */}
							<AccordionItem value="item-6" className="py-5 border-border/50">
								<AccordionPrimitive.Header className="flex">
									<AccordionPrimitive.Trigger className="focus-visible:border-ring focus-visible:ring-ring/50 flex flex-1 items-center justify-between gap-4 rounded-md py-2 text-left font-display text-lg md:text-xl font-medium leading-7 transition-all outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&>svg>path:last-child]:origin-center [&>svg>path:last-child]:transition-all [&>svg>path:last-child]:duration-200 [&[data-state=open]>svg]:rotate-180 [&[data-state=open]>svg>path:last-child]:rotate-90 [&[data-state=open]>svg>path:last-child]:opacity-0 text-foreground">
										Are all 200+ models included on every plan?
										<PlusIcon
											size={18}
											className="pointer-events-none shrink-0 opacity-60 transition-transform duration-200"
											aria-hidden="true"
										/>
									</AccordionPrimitive.Trigger>
								</AccordionPrimitive.Header>
								<AccordionContent className="overflow-hidden transition-all data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up text-base text-muted-foreground leading-relaxed pb-2">
									<div className="border-l-2 border-foreground/10 pl-4">
										Yes. Every plan includes the full catalog — Claude, GPT-5,
										Gemini, Llama, Qwen, and the rest. Plans differ only in the
										size of your monthly usage allowance.
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
