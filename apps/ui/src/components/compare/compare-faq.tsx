"use client";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { PlusIcon } from "lucide-react";

import {
	Accordion,
	AccordionContent,
	AccordionItem,
} from "@/lib/components/accordion";

export interface CompareFaqItem {
	question: string;
	answer: string;
}

interface CompareFaqProps {
	heading: string;
	description?: string;
	faqs: CompareFaqItem[];
}

export function CompareFaq({ heading, description, faqs }: CompareFaqProps) {
	const faqSchema = {
		"@context": "https://schema.org",
		"@type": "FAQPage",
		mainEntity: faqs.map((item) => ({
			"@type": "Question",
			name: item.question,
			acceptedAnswer: {
				"@type": "Answer",
				text: item.answer,
			},
		})),
	};

	return (
		<section className="w-full py-20 md:py-28 bg-background" id="faq">
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{
					__html: JSON.stringify(faqSchema),
				}}
			/>
			<div className="container mx-auto px-4 md:px-6">
				<div className="grid grid-cols-1 lg:grid-cols-5 gap-12 lg:gap-16">
					<div className="lg:col-span-2 lg:sticky lg:top-24 lg:self-start">
						<p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-4">
							FAQ
						</p>
						<h2 className="font-display text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight text-foreground">
							{heading}
						</h2>
						{description ? (
							<p className="mt-4 text-muted-foreground">{description}</p>
						) : null}
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

					<div className="lg:col-span-3">
						<Accordion
							type="single"
							collapsible
							className="w-full"
							defaultValue="item-1"
						>
							{faqs.map((item, index) => (
								<AccordionItem
									key={item.question}
									value={`item-${index + 1}`}
									className="py-5 border-border/50"
								>
									<AccordionPrimitive.Header className="flex">
										<AccordionPrimitive.Trigger className="focus-visible:border-ring focus-visible:ring-ring/50 flex flex-1 items-center justify-between gap-4 rounded-md py-2 text-left font-display text-lg md:text-xl font-medium leading-7 transition-all outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&>svg>path:last-child]:origin-center [&>svg>path:last-child]:transition-all [&>svg>path:last-child]:duration-200 [&[data-state=open]>svg]:rotate-180 [&[data-state=open]>svg>path:last-child]:rotate-90 [&[data-state=open]>svg>path:last-child]:opacity-0 text-foreground">
											{item.question}
											<PlusIcon
												size={18}
												className="pointer-events-none shrink-0 opacity-60 transition-transform duration-200"
												aria-hidden="true"
											/>
										</AccordionPrimitive.Trigger>
									</AccordionPrimitive.Header>
									<AccordionContent className="overflow-hidden transition-all data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up text-base text-muted-foreground leading-relaxed pb-2">
										<div className="border-l-2 border-foreground/10 pl-4">
											{item.answer}
										</div>
									</AccordionContent>
								</AccordionItem>
							))}
						</Accordion>
					</div>
				</div>
			</div>
		</section>
	);
}
