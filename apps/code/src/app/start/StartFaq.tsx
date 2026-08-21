"use client";

import Link from "next/link";

import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@/components/ui/accordion";

import {
	MARKETING_STATS,
	SELF_REFUND_USAGE_PERCENT,
	SELF_REFUND_WINDOW_DAYS,
} from "@llmgateway/shared";

import type { ReactNode } from "react";

const faqItems: { question: string; answer: ReactNode }[] = [
	{
		question: "Which coding agents work with DevPass?",
		answer:
			"Anything that speaks the OpenAI or Anthropic API — DevPass Code, Claude Code, OpenCode, GitHub Copilot, Empryo, SoulForge, Cursor, Cline, Continue, Aider, the OpenAI and Anthropic SDKs, and more. Set two environment variables and you're in.",
	},
	{
		question: "Can I pick which provider serves my requests?",
		answer: (
			<>
				No — DevPass always smart-routes. You request a model by its plain id
				(e.g. <code className="font-mono text-sm">claude-sonnet-5</code>) and
				the gateway picks the best provider in real time based on uptime, speed,
				price, and prompt caching. Provider-prefixed ids like{" "}
				<code className="font-mono text-sm">openai/gpt-4o</code> aren&apos;t
				available on DevPass. If you need to pin an exact provider or region,
				use{" "}
				<Link href="https://llmgateway.io" className="underline">
					LLM Gateway&apos;s pay-as-you-go API
				</Link>{" "}
				instead.
			</>
		),
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
				If DevPass isn&apos;t for you and you&apos;ve used less than{" "}
				{SELF_REFUND_USAGE_PERCENT}% of your monthly allowance, refund yourself
				from{" "}
				<Link href="/dashboard/billing" className="underline">
					Billing
				</Link>{" "}
				in your dashboard — no email needed. You get your first month back in
				full, up to {SELF_REFUND_WINDOW_DAYS} days after the purchase; the
				refund ends the plan right away, and there&apos;s no cancellation fee.
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
