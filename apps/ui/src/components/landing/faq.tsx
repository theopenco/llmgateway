import { PlusIcon } from "lucide-react";

import { TrackedLink } from "@/components/home/tracked-link";

import { MARKETING_STATS } from "@llmgateway/shared";

interface FaqEntry {
	question: string;
	answer: string;
	link?: { href: string; label: string };
}

const faqData: FaqEntry[] = [
	{
		question: "What is the 30-day production pilot?",
		answer:
			"Enterprise starts with a pilot on your own traffic. In week 1 we move your keys, routing rules and first production traffic with you. In week 2 SSO, audit logs and guardrails are set up and checked by your security team. At day 30 you decide. If we missed a milestone, you can walk away, with no long-term contract before that point.",
		link: { href: "/enterprise#contact", label: "Start your pilot" },
	},
	{
		question: "How much does it cost?",
		answer: `Bring your own provider keys at no platform fee. Credits are pay-as-you-go with a ${MARKETING_STATS.platformFee} platform fee on top-ups and no token markup; non-US cards may add a 1.5% international card fee. Optional full data retention costs ${MARKETING_STATS.dataStoragePrice} in both modes. Enterprise pricing is custom, with volume discounts and a 99.9% uptime SLA on Enterprise Cloud.`,
		link: { href: "/pricing", label: "See pricing" },
	},
	{
		question: "Can we self-host LLM Gateway?",
		answer:
			"Yes. Run it with Docker or Kubernetes using our Helm chart, inside your own network. The core gateway is open source under AGPLv3 and free to self-host. Enterprise features such as SSO, audit logs and guardrails need an enterprise license.",
	},
	{
		question: "What is your uptime guarantee?",
		answer:
			"Our public status page shows live status and 90-day uptime. Enterprise Cloud contracts include a 99.9% uptime SLA. Pay-as-you-go has no SLA, and self-hosted installs depend on your infrastructure.",
		link: { href: "https://status.llmgateway.io", label: "Status page" },
	},
	{
		question: "How is LLM Gateway different from OpenRouter?",
		answer:
			"LLM Gateway is open source: you can self-host the gateway under AGPLv3, while enterprise features need a license. Your own provider keys carry no platform fee at any volume, while OpenRouter charges 5% on bring-your-own-key usage above $25k of list-price inference a month ($200k on its enterprise plan). Stripe announced in August 2026 that it is acquiring OpenRouter.",
		link: { href: "/compare/open-router", label: "Full comparison" },
	},
	{
		question: "Which models do you support?",
		answer: `${MARKETING_STATS.models} models from ${MARKETING_STATS.providers} providers, and most major releases go live within 48 hours of launch.`,
		link: { href: "/models", label: "Browse all models" },
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

function AnswerLink({ href, label }: { href: string; label: string }) {
	return (
		<TrackedLink
			href={href}
			external={href.startsWith("http")}
			location="home_faq"
			cta={label.toLowerCase().replace(/\s+/g, "_")}
			className="mt-3 inline-block font-medium text-foreground underline underline-offset-4"
		>
			{label}
		</TrackedLink>
	);
}

export function Faq() {
	return (
		<section className="w-full bg-background py-20 md:py-32" id="faq">
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{
					__html: JSON.stringify(faqSchema),
				}}
			/>
			<div className="mx-auto max-w-7xl px-4 sm:px-6">
				<div className="grid grid-cols-1 gap-12 lg:grid-cols-5 lg:gap-16">
					<div className="lg:sticky lg:top-24 lg:col-span-2 lg:self-start">
						<p className="mb-4 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
							FAQ
						</p>
						<h2 className="font-display text-3xl font-bold tracking-tight text-foreground md:text-4xl lg:text-5xl">
							Common questions
						</h2>
						<p className="mt-4 text-muted-foreground">
							Pilots, pricing, self-hosting and uptime.
						</p>
						<p className="mt-6 text-sm text-muted-foreground">
							Can&apos;t find an answer?{" "}
							<a
								href="mailto:contact@llmgateway.io"
								className="text-foreground underline underline-offset-4"
							>
								Contact us
							</a>
						</p>
					</div>

					<div className="lg:col-span-3">
						<div className="w-full">
							{faqData.map((item, index) => (
								<details
									key={item.question}
									open={index === 0}
									className="group border-b border-border/50 py-5"
								>
									<summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-md py-2 text-left text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
										<h3 className="font-display text-lg font-medium leading-7 md:text-xl">
											{item.question}
										</h3>
										<PlusIcon
											size={18}
											className="pointer-events-none shrink-0 opacity-60 transition-transform duration-200 group-open:rotate-45"
											aria-hidden="true"
										/>
									</summary>
									<div className="mt-2 border-l-2 border-foreground/10 pb-2 pl-4 text-base leading-relaxed text-muted-foreground">
										<p>{item.answer}</p>
										{item.link && <AnswerLink {...item.link} />}
									</div>
								</details>
							))}
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}
