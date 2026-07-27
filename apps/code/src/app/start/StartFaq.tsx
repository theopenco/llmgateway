"use client";

import Link from "next/link";

import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@/components/ui/accordion";

import { MARKETING_STATS } from "@llmgateway/shared";

import type { ReactNode } from "react";

const faqItems: { question: string; answer: ReactNode }[] = [
	{
		question: "Which coding agents work with DevPass?",
		answer:
			"Anything that speaks the OpenAI or Anthropic API — DevPass Code, Claude Code, OpenCode, Empryo, SoulForge, Cursor, Cline, Continue, Aider, the OpenAI and Anthropic SDKs, and more. Set two environment variables and you're in.",
	},
	{
		question: "What models are included?",
		answer: `Every plan includes the full ${MARKETING_STATS.models} model catalog — Claude, GPT-5, Gemini, Llama, Qwen, and the rest. Plans differ in the size of your monthly usage allowance and the weekly fair-use allowance on premium frontier models.`,
	},
	{
		question: "How is usage metered?",
		answer:
			"Usage is metered at each provider's published per-token rate (input, output, and cached tokens). You can see the dollar value of every request in your dashboard in real time.",
	},
	{
		question: "What's the first-month guarantee?",
		answer: (
			<>
				Cancel within 7 days of your first purchase and email{" "}
				<Link href="mailto:contact@llmgateway.io" className="underline">
					contact@llmgateway.io
				</Link>
				: we&apos;ll refund your first month minus the usage you consumed at
				provider rates. There&apos;s no cancellation fee.
			</>
		),
	},
];

export function StartFaq() {
	return (
		<Accordion type="single" collapsible className="w-full">
			{faqItems.map((item) => (
				<AccordionItem
					key={item.question}
					value={item.question}
					className="border-border/50"
				>
					<AccordionTrigger className="font-display text-base font-medium sm:text-lg">
						{item.question}
					</AccordionTrigger>
					<AccordionContent className="text-sm leading-relaxed text-muted-foreground sm:text-base">
						{item.answer}
					</AccordionContent>
				</AccordionItem>
			))}
		</Accordion>
	);
}
