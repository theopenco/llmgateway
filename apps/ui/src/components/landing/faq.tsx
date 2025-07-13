import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { PlusIcon } from "lucide-react";

import {
	Accordion,
	AccordionContent,
	AccordionItem,
} from "@/lib/components/accordion";

export function Faq() {
	return (
		<section
			className="w-full py-12 md:py-24 lg:py-32 bg-white dark:bg-black"
			id="faq"
		>
			<div className="container mx-auto px-4 md:px-6">
				{/* Heading */}
				<div className="flex flex-col items-center justify-center space-y-4 text-center">
					<div className="space-y-2">
						<h2 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl dark:text-white">
							Frequently Asked Questions
						</h2>
						<p className="max-w-[700px] text-gray-500 md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed dark:text-gray-400">
							Find answers to common questions about our services and offerings.
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
								<AccordionPrimitive.Trigger className="focus-visible:border-ring focus-visible:ring-ring/50 flex flex-1 items-center justify-between gap-4 rounded-md py-2 text-left text-lg font-medium leading-6 transition-all outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&>svg>path:last-child]:origin-center [&>svg>path:last-child]:transition-all [&>svg>path:last-child]:duration-200 [&[data-state=open]>svg]:rotate-180 [&[data-state=open]>svg>path:last-child]:rotate-90 [&[data-state=open]>svg>path:last-child]:opacity-0 dark:text-gray-200 cursor-pointer">
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
										Full <strong>self‑hosting</strong> under an MIT license –
										run the gateway entirely on your infra, free forever
									</li>
									<li>
										Deeper, real‑time <strong>cost & latency analytics</strong>{" "}
										for every request
									</li>
									<li>
										<strong>Zero gateway fee</strong> on the $50 Pro plan when
										you bring your own provider keys
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
								<AccordionPrimitive.Trigger className="focus-visible:border-ring focus-visible:ring-ring/50 flex flex-1 items-center justify-between gap-4 rounded-md py-2 text-left text-lg font-medium leading-6 transition-all outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&>svg>path:last-child]:origin-center [&>svg>path:last-child]:transition-all [&>svg>path:last-child]:duration-200 [&[data-state=open]>svg]:rotate-180 [&[data-state=open]>svg>path:last-child]:rotate-90 [&[data-state=open]>svg>path:last-child]:opacity-0 dark:text-gray-200 cursor-pointer">
									What models do you support?
									<PlusIcon
										size={18}
										className="pointer-events-none shrink-0 opacity-60 transition-transform duration-200"
										aria-hidden="true"
									/>
								</AccordionPrimitive.Trigger>
							</AccordionPrimitive.Header>
							<AccordionContent className="overflow-hidden transition-all data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up text-gray-500 dark:text-gray-400 pb-2">
								We support a growing catalog of commercial and open‑source LLMs
								across all major providers (OpenAI, Anthropic, Google and more).
								Check the{" "}
								<a href="/models" className="underline">
									models page
								</a>{" "}
								for the up‑to‑date list – we typically add new releases within
								48 hours.
							</AccordionContent>
						</AccordionItem>

						{/* Item 3 – uptime */}
						<AccordionItem value="item-3" className="py-2">
							<AccordionPrimitive.Header className="flex">
								<AccordionPrimitive.Trigger className="focus-visible:border-ring focus-visible:ring-ring/50 flex flex-1 items-center justify-between gap-4 rounded-md py-2 text-left text-lg font-medium leading-6 transition-all outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&>svg>path:last-child]:origin-center [&>svg>path:last-child]:transition-all [&>svg>path:last-child]:duration-200 [&[data-state=open]>svg]:rotate-180 [&[data-state=open]>svg>path:last-child]:rotate-90 [&[data-state=open]>svg>path:last-child]:opacity-0 dark:text-gray-200 cursor-pointer">
									What is your uptime guarantee?
									<PlusIcon
										size={18}
										className="pointer-events-none shrink-0 opacity-60 transition-transform duration-200"
										aria-hidden="true"
									/>
								</AccordionPrimitive.Trigger>
							</AccordionPrimitive.Header>
							<AccordionContent className="overflow-hidden transition-all data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up text-gray-500 dark:text-gray-400 pb-2">
								Our public status page posts real‑time metrics. Managed Pro &
								Enterprise instances come with a{" "}
								<strong>99.9 % uptime SLA</strong>; self‑host installations
								depend on your infrastructure.
							</AccordionContent>
						</AccordionItem>

						{/* Item 4 – pricing */}
						<AccordionItem value="item-4" className="py-2">
							<AccordionPrimitive.Header className="flex">
								<AccordionPrimitive.Trigger className="focus-visible:border-ring focus-visible:ring-ring/50 flex flex-1 items-center justify-between gap-4 rounded-md py-2 text-left text-lg font-medium leading-6 transition-all outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&>svg>path:last-child]:origin-center [&>svg>path:last-child]:transition-all [&>svg>path:last-child]:duration-200 [&[data-state=open]>svg]:rotate-180 [&[data-state=open]>svg>path:last-child]:rotate-90 [&[data-state=open]>svg>path:last-child]:opacity-0 dark:text-gray-200 cursor-pointer">
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
										<strong>Free – credits + 5% fee + Stripe:</strong>{" "}
										Pay‑as‑you‑go credits to use any model; a flat 5% platform
										fee is applied to each request, plus standard Stripe
										processing fees (2.9% + $0.35) on purchases.
									</li>
									<li>
										<strong>Pro – $50/month:</strong> Bring your own LLM
										provider keys <em>or</em> use credits with{" "}
										<strong>zero</strong> gateway fee. Includes premium
										analytics, higher rate limits, and priority email support.
									</li>
									<li>
										<strong>Enterprise:</strong> Custom SLA, dedicated
										infrastructure, bring-your-own cloud capacity, and volume
										discounts. Contact sales for a tailored quote.
									</li>
									<li>
										<strong>Self‑host:</strong> Deploy the MIT‑licensed gateway
										on your own infrastructure — free forever.
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
