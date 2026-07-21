"use client";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { PlusIcon } from "lucide-react";
import Link from "next/link";

import {
	Accordion,
	AccordionContent,
	AccordionItem,
} from "@/components/ui/accordion";

import {
	DEV_PLAN_INCLUDED_RESET_PASSES,
	DEV_PLAN_RESET_PASS_PRICES,
	HIGH_COST_INPUT_PRICE,
	HIGH_COST_OUTPUT_PRICE,
	MARKETING_STATS,
} from "@llmgateway/shared";

import type { ReactNode } from "react";

interface FaqItem {
	question: string;
	// Plain-text answer used for the FAQPage JSON-LD schema (and as the
	// rendered fallback when no rich `content` is provided).
	answer: string;
	content?: ReactNode;
}

const premiumInputPerM = Math.round(HIGH_COST_INPUT_PRICE * 1_000_000);
const premiumOutputPerM = Math.round(HIGH_COST_OUTPUT_PRICE * 1_000_000);

const faqData: FaqItem[] = [
	{
		question: "How much usage do I get on each plan?",
		answer:
			"Every plan includes a fixed monthly usage allowance, calculated at standard provider rates. Lite ($29/mo) includes $87 in model usage, Pro ($79/mo) includes $237, and Max ($179/mo) includes $537 — roughly 3× the subscription price.",
		content: (
			<>
				<p>
					Every plan includes a fixed monthly usage allowance, calculated at
					standard provider rates:
				</p>
				<ul className="list-disc pl-6 mt-2 space-y-1">
					<li>
						<strong>Lite — $29/mo:</strong> $87 in monthly model usage
					</li>
					<li>
						<strong>Pro — $79/mo:</strong> $237 in monthly model usage
					</li>
					<li>
						<strong>Max — $179/mo:</strong> $537 in monthly model usage
					</li>
				</ul>
				<p className="mt-3">
					That&apos;s roughly 3× the subscription price — effectively model
					access at a deep discount compared to paying providers directly.
				</p>
			</>
		),
	},
	{
		question: "How is usage calculated?",
		answer:
			"Usage is metered at each provider's published per-token rate (input, output, and cached tokens). You can see the dollar value of every request in your dashboard in real time.",
	},
	{
		question: "What happens if I hit my monthly limit?",
		answer:
			"Requests pause until your allowance resets at the start of the next billing cycle. Or upgrade to a higher tier at any time: an immediate upgrade charges the new tier's full price, restarts your billing cycle, and grants the new tier's full monthly allowance right away — plus anything left of your current allowance rolls over. Credits only roll over on an immediate upgrade, never at a regular renewal.",
		content: (
			<>
				Requests pause until your allowance resets at the start of the next
				billing cycle. Or <strong>upgrade to a higher tier at any time</strong>:
				an immediate upgrade charges the new tier&apos;s full price, restarts
				your billing cycle, and grants the new tier&apos;s full monthly
				allowance right away — plus anything left of your current allowance
				rolls over. Credits only roll over on an immediate upgrade, never at a
				regular renewal.
			</>
		),
	},
	{
		question: "Can I change plans anytime?",
		answer:
			"Yes. Upgrades can take effect immediately — you're charged the new tier's full price, your billing cycle restarts, and you get the new tier's full allowance right away, plus any unspent credits from the cycle being replaced roll over until your next renewal — or you can schedule the upgrade for your next renewal instead. Downgrades take effect at your next renewal. There's no lock-in and no cancellation fee.",
	},
	{
		question: "Do I need a subscription, or is there pay-as-you-go?",
		answer: `Both work. DevPass plans turn every dollar into $3 of model usage. If you'd rather not subscribe, LLM Gateway offers pay-as-you-go: top up credits and pay per token at provider rates with a flat ${MARKETING_STATS.platformFee} platform fee, or bring your own provider keys for free.`,
	},
	{
		question: "Which tools and SDKs work with DevPass?",
		answer:
			"Anything that speaks the OpenAI or Anthropic API — Claude Code, Empryo, SoulForge, Cursor, Cline, Continue, Aider, the OpenAI and Anthropic SDKs, and more. Set two environment variables and you're in.",
	},
	{
		question: "Are all 200+ models included on every plan?",
		answer:
			"Yes. Every plan includes the full catalog — Claude, GPT-5, Gemini, Llama, Qwen, and the rest. Plans differ in the size of your monthly usage allowance and the weekly fair-use allowance on premium frontier models.",
	},
	{
		question: "Are there limits on premium models?",
		answer: `Premium models — any model priced at $${premiumInputPerM}+ per million input tokens or $${premiumOutputPerM}+ per million output tokens — are subject to a weekly fair-use allowance in addition to your monthly allowance: 12% of your monthly credits on Lite, 15% on Pro, and 18% on Max. Every other model draws on your full monthly allowance. The exact numbers are published on the plan cards — no hidden throttling.`,
		content: (
			<>
				<p>
					Premium models — any model priced at ${premiumInputPerM}+ per million
					input tokens or ${premiumOutputPerM}+ per million output tokens — are
					subject to a weekly fair-use allowance in addition to your monthly
					allowance:
				</p>
				<ul className="list-disc pl-6 mt-2 space-y-1">
					<li>
						<strong>Lite:</strong> 12% of monthly credits
					</li>
					<li>
						<strong>Pro:</strong> 15% of monthly credits
					</li>
					<li>
						<strong>Max:</strong> 18% of monthly credits
					</li>
				</ul>
				<p className="mt-3">
					Every other model draws on your full monthly allowance. The exact
					numbers are published on the plan cards — no hidden throttling. See{" "}
					<Link
						href="https://docs.llmgateway.io/learn/model-categories"
						className="underline"
					>
						model categories &amp; fair use
					</Link>{" "}
					for how models are classified.
				</p>
			</>
		),
	},
	{
		question: "What if I hit the weekly premium allowance mid-week?",
		answer: `Redeem a Reset Pass: it instantly restores your full weekly premium allowance and starts a fresh 7-day window. A pass removes the weekly limit only — it doesn't add credits, so usage still draws from your monthly allowance. Pro includes ${DEV_PLAN_INCLUDED_RESET_PASSES.pro} pass per billing cycle and Max includes ${DEV_PLAN_INCLUDED_RESET_PASSES.max}; extra passes are a one-time purchase from your dashboard ($${DEV_PLAN_RESET_PASS_PRICES.lite} on Lite, $${DEV_PLAN_RESET_PASS_PRICES.pro} on Pro, $${DEV_PLAN_RESET_PASS_PRICES.max} on Max). Standard models keep working the whole time, and if you're resetting every week, upgrading a tier is usually the better deal.`,
	},
	{
		question: "Does the weekly premium allowance reset when my plan renews?",
		answer:
			"Yes. Every monthly renewal resets everything at once: your monthly credits, your weekly premium allowance (a fresh 7-day window starts at renewal), and your included Reset Passes. Between renewals the window is rolling — when 7 days end, the next window starts with your next premium request, and redeeming a Reset Pass clears the window so the next request starts a fresh one. There's no reset schedule to manage — neither the weekly window nor unused included passes carry into the next cycle. Purchased Reset Passes are separate: they persist until redeemed.",
		content: (
			<>
				<p>
					Yes. Every monthly renewal resets everything at once: your monthly
					credits, your weekly premium allowance (a fresh 7-day window starts at
					renewal), and your included Reset Passes.
				</p>
				<p className="mt-3">
					Between renewals the window is rolling — when 7 days end, the next
					window starts with your next premium request, and redeeming a Reset
					Pass clears the window so the next request starts a fresh one.
					There&apos;s no reset schedule to manage — neither the weekly window
					nor unused included passes carry into the next cycle. Purchased Reset
					Passes are separate: they persist until redeemed. See{" "}
					<Link
						href="https://docs.llmgateway.io/learn/reset-passes"
						className="underline"
					>
						Reset Passes
					</Link>{" "}
					for the full mechanics.
				</p>
			</>
		),
	},
	{
		question: "Can I get a refund?",
		answer:
			"Yes — DevPass comes with a first-month guarantee. Cancel within 7 days of your first purchase and email contact@llmgateway.io: we'll refund your first month minus the usage you consumed at provider rates. There's no cancellation fee.",
		content: (
			<>
				Yes — DevPass comes with a <strong>first-month guarantee</strong>.
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
							{faqData.map((item, idx) => (
								<AccordionItem
									key={item.question}
									value={`item-${idx + 1}`}
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
											{item.content ?? item.answer}
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
