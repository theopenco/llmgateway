import Link from "next/link";

import { BRAND } from "@/lib/brand";

import {
	CHAT_PLAN_PRICES,
	getChatPlanCreditsLimit,
	MARKETING_STATS,
	SELF_REFUND_USAGE_PERCENT,
	SELF_REFUND_WINDOW_DAYS,
} from "@llmgateway/shared";

const MODEL_FAMILIES = [
	"GPT-5",
	"Claude Opus",
	"Claude Sonnet",
	"Gemini Pro",
	"Gemini Flash",
	"Grok",
	"DeepSeek",
	"Llama",
	"Mistral",
];

const STUDIOS = [
	{
		href: "/group",
		name: "Group chat",
		description:
			"One prompt, several models answering side by side — compare quality, speed, and cost in real time.",
	},
	{
		href: "/image",
		name: "Image studio",
		description:
			"Generate images with DALL·E, Flux, and Stable Diffusion — up to four variants per prompt, side by side.",
	},
	{
		href: "/video",
		name: "Video studio",
		description:
			"Text-to-video with Google Veo, Alibaba Wan, and more, previewed right in the browser.",
	},
	{
		href: "/audio",
		name: "Audio studio",
		description:
			"Text to speech with ElevenLabs, OpenAI, and Gemini voices — pick a voice, compare, download.",
	},
	{
		href: "/canvas",
		name: "Canvas",
		description:
			"Generate and edit UI specs as JSON with live preview, then export to PDF or PNG.",
	},
	{
		href: "/compare",
		name: "Comparisons",
		description:
			"How Lounge stacks up against ChatGPT, Claude, Gemini, and the other chat subscriptions.",
	},
];

const USE_CASES = [
	{
		name: "Writing and editing",
		description:
			"Draft, rewrite, and polish anything with the model that suits the job — then switch mid-conversation when another does it better.",
	},
	{
		name: "Coding help",
		description:
			"Debug, review, and explain code with frontier coding models, with files and images attached for context.",
	},
	{
		name: "Research with web search",
		description:
			"Turn on web search and get sourced answers on current events instead of a model's memory alone.",
	},
	{
		name: "Choosing a model",
		description:
			"Run the same prompt through several models in a group chat and see which one earns a place in your workflow.",
	},
];

function formatUsd(value: number): string {
	return value % 1 === 0 ? `$${value}` : `$${value.toFixed(2)}`;
}

const PLANS = [
	{
		name: "Starter",
		price: CHAT_PLAN_PRICES.starter,
		allowance: getChatPlanCreditsLimit("starter"),
		description:
			"The fast models — Claude Sonnet and Haiku, Gemini Flash, and hundreds more.",
	},
	{
		name: "Plus",
		price: CHAT_PLAN_PRICES.plus,
		allowance: getChatPlanCreditsLimit("plus"),
		description:
			"Every frontier flagship — Claude Opus, GPT-5, Gemini Pro, and Grok included.",
		featured: true,
	},
	{
		name: "Pro",
		price: CHAT_PLAN_PRICES.pro,
		allowance: getChatPlanCreditsLimit("pro"),
		description:
			"The same full catalogue with the largest allowance, for heavy daily use.",
	},
];

const FAQ_ITEMS = [
	{
		question: "What is Lounge?",
		answer: `Lounge is the members' AI chat by LLM Gateway. One membership covers chat with ${MARKETING_STATS.models} AI models — including GPT, Claude, Gemini, and Grok — plus image, video, and audio generation, side-by-side group chats, and a canvas studio, all from a single credit balance.`,
	},
	{
		question: "Which AI models can I chat with?",
		answer: `Lounge routes to ${MARKETING_STATS.models} models across OpenAI, Anthropic, Google, xAI, DeepSeek, Meta, Mistral, and other providers through LLM Gateway. New frontier models arrive as providers release them, and you can switch models mid-conversation without losing context.`,
	},
	{
		question: "How much does a Lounge membership cost?",
		answer: `Starter is $${CHAT_PLAN_PRICES.starter}/month for the fast models, Plus is $${CHAT_PLAN_PRICES.plus}/month and unlocks every frontier flagship, and Pro is $${CHAT_PLAN_PRICES.pro}/month for heavy daily use. Every tier includes a credit allowance worth more than the price you pay, refreshed each billing cycle.`,
	},
	{
		question: "Do I still need ChatGPT Plus, Claude Pro, or Gemini Advanced?",
		answer:
			"No. One Lounge membership replaces separate ChatGPT Plus, Claude Pro, and Gemini Advanced subscriptions — every frontier flagship lives in the same lounge, and you can put them side by side in a group chat before trusting any one of them.",
	},
	{
		question: "Can Lounge generate images, video, and audio?",
		answer:
			"Yes. Dedicated studios cover image generation with DALL·E, Flux, and Stable Diffusion, video generation with Veo and Wan, and text to speech with ElevenLabs, OpenAI, and Gemini voices — alongside chat and multi-model group chats.",
	},
	{
		question: "Are my conversations private?",
		answer:
			"Conversations are private to your account, and a chat is only visible to others if you explicitly create a read-only share link. LLM Gateway does not use your conversations to train models. The LLM Gateway privacy policy covers the full details.",
	},
	{
		question: "What happens to unused credits?",
		answer: `Your full credit allowance refills at the start of each billing cycle, and unspent credits don't roll over. If you've barely used a new membership, you can refund yourself from your billing history for up to ${SELF_REFUND_WINDOW_DAYS} days, as long as you're under ${SELF_REFUND_USAGE_PERCENT}% of your allowance.`,
	},
];

const faqSchema = {
	"@context": "https://schema.org",
	"@type": "FAQPage",
	mainEntity: FAQ_ITEMS.map((item) => ({
		"@type": "Question",
		name: item.question,
		acceptedAnswer: {
			"@type": "Answer",
			text: item.answer,
		},
	})),
};

function Kicker({ children }: { children: string }) {
	return (
		<p className="mb-4 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.28em] text-lounge-gold">
			<span aria-hidden className="h-px w-8 bg-lounge-gold/50" />
			{children}
		</p>
	);
}

/**
 * Crawlable landing content rendered below the full-viewport chat app for
 * signed-out visitors (and therefore crawlers). Members get the clean app
 * without a marketing tail — see renderPlaygroundShell.
 */
export function LoungeLandingSections() {
	return (
		<div className="border-t bg-background">
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{
					__html: JSON.stringify(faqSchema).replace(/</g, "\\u003c"),
				}}
			/>

			<div className="mx-auto max-w-6xl px-4 py-20 sm:py-28">
				{/* Definition */}
				<header className="max-w-3xl">
					<Kicker>{`${BRAND.displayName} · Members' AI chat`}</Kicker>
					<h1 className="font-display text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
						Lounge — AI chat with {MARKETING_STATS.models} models in one place
					</h1>
					<p className="mt-6 text-lg leading-relaxed text-muted-foreground">
						Lounge is the members&apos; AI chat by{" "}
						<a
							href="https://llmgateway.io"
							className="underline underline-offset-4 hover:text-foreground"
						>
							LLM Gateway
						</a>
						. One membership covers GPT, Claude, Gemini, Grok, and{" "}
						{MARKETING_STATS.models} models in total — chat, side-by-side group
						chats, and image, video, and audio studios, drawing on a single
						credit balance instead of a stack of per-provider subscriptions.
					</p>
				</header>

				{/* Models */}
				<section className="mt-20 grid gap-10 lg:grid-cols-2 lg:gap-16">
					<div>
						<h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
							Every frontier model, one membership
						</h2>
						<p className="mt-4 leading-relaxed text-muted-foreground">
							The house catalogue spans {MARKETING_STATS.models} models from{" "}
							{MARKETING_STATS.providers} providers, routed through LLM Gateway.
							When a new flagship ships, it appears in the model picker — no new
							account, no new bill. Switch models mid-conversation and keep your
							context.
						</p>
						<p className="mt-4 text-sm text-muted-foreground">
							<a
								href="https://llmgateway.io/models"
								className="underline underline-offset-4 hover:text-foreground"
							>
								Browse the full model catalogue
							</a>
						</p>
					</div>
					<ul className="flex flex-wrap content-start items-start gap-2.5">
						{MODEL_FAMILIES.map((family) => (
							<li
								key={family}
								className="rounded-full border border-border/70 bg-muted/40 px-4 py-1.5 font-mono text-sm text-foreground"
							>
								{family}
							</li>
						))}
						<li className="rounded-full border border-lounge-gold/40 bg-lounge-gold/10 px-4 py-1.5 font-mono text-sm text-lounge-gold">
							and {MARKETING_STATS.models} more
						</li>
					</ul>
				</section>

				{/* Studios */}
				<section className="mt-20">
					<Kicker>Inside the Lounge</Kicker>
					<h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
						Six studios, one seat
					</h2>
					<div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
						{STUDIOS.map((studio) => (
							<Link
								key={studio.href}
								href={studio.href}
								className="group rounded-2xl border bg-card p-6 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-lounge-gold/50 hover:shadow-lg"
							>
								<h3 className="font-display text-lg font-semibold tracking-tight">
									{studio.name}
								</h3>
								<p className="mt-2 text-sm leading-6 text-muted-foreground">
									{studio.description}
								</p>
								<span className="mt-4 inline-block text-sm font-medium text-lounge-gold">
									Step inside →
								</span>
							</Link>
						))}
					</div>
				</section>

				{/* Use cases */}
				<section className="mt-20">
					<h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
						What members use the Lounge for
					</h2>
					<dl className="mt-8 grid gap-x-12 gap-y-8 sm:grid-cols-2">
						{USE_CASES.map((useCase) => (
							<div key={useCase.name}>
								<dt className="font-semibold text-foreground">
									{useCase.name}
								</dt>
								<dd className="mt-2 text-sm leading-6 text-muted-foreground">
									{useCase.description}
								</dd>
							</div>
						))}
					</dl>
				</section>

				{/* Membership pricing */}
				<section className="mt-20">
					<Kicker>Membership</Kicker>
					<h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
						Membership pricing
					</h2>
					<p className="mt-4 max-w-2xl leading-relaxed text-muted-foreground">
						{BRAND.tagline} Every tier includes a monthly credit allowance worth
						more than the price you pay, refreshed each billing cycle.
					</p>
					<div className="mt-8 grid gap-5 md:grid-cols-3">
						{PLANS.map((plan) => (
							<div
								key={plan.name}
								className={`rounded-2xl border p-6 ${
									plan.featured
										? "border-lounge-gold/60 bg-lounge-gold/5"
										: "bg-card"
								}`}
							>
								<h3 className="font-display text-lg font-semibold tracking-tight">
									{plan.name}
								</h3>
								<p className="mt-2 font-mono text-2xl font-semibold">
									${plan.price}
									<span className="text-sm font-normal text-muted-foreground">
										/month
									</span>
								</p>
								<p className="mt-1 text-xs text-muted-foreground">
									{formatUsd(plan.allowance)} of model usage included
								</p>
								<p className="mt-4 text-sm leading-6 text-muted-foreground">
									{plan.description}
								</p>
							</div>
						))}
					</div>
					<p className="mt-6 text-sm text-muted-foreground">
						Cancel anytime, with a self-serve {SELF_REFUND_WINDOW_DAYS}-day
						money-back guarantee on new memberships.{" "}
						<Link
							href="/pricing"
							className="text-foreground underline underline-offset-4"
						>
							See full membership details
						</Link>
					</p>
				</section>

				{/* Privacy */}
				<section className="mt-20 max-w-3xl">
					<h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
						Private by default
					</h2>
					<ul className="mt-6 space-y-3 text-muted-foreground">
						<li className="leading-relaxed">
							<strong className="text-foreground">
								Your conversations stay yours.
							</strong>{" "}
							Chats are private to your account, and you can delete them at any
							time.
						</li>
						<li className="leading-relaxed">
							<strong className="text-foreground">Sharing is explicit.</strong>{" "}
							A conversation only becomes visible to others when you create a
							read-only share link for it.
						</li>
						<li className="leading-relaxed">
							<strong className="text-foreground">No training on you.</strong>{" "}
							LLM Gateway does not use your conversations to train models. Read
							the{" "}
							<a
								href="https://llmgateway.io/legal/privacy"
								className="text-foreground underline underline-offset-4"
							>
								privacy policy
							</a>{" "}
							for the full picture.
						</li>
					</ul>
				</section>

				{/* FAQ */}
				<section className="mt-20 max-w-3xl">
					<Kicker>Common questions</Kicker>
					<h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
						Lounge, answered
					</h2>
					<div className="mt-8 divide-y divide-border/60 border-y border-border/60">
						{FAQ_ITEMS.map((item) => (
							<details key={item.question} className="group py-5">
								<summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display text-lg font-medium text-foreground [&::-webkit-details-marker]:hidden">
									{item.question}
									<span
										aria-hidden
										className="shrink-0 text-lounge-gold transition-transform duration-200 group-open:rotate-45"
									>
										+
									</span>
								</summary>
								<p className="mt-3 border-l-2 border-lounge-gold/30 pl-4 leading-relaxed text-muted-foreground">
									{item.answer}
								</p>
							</details>
						))}
					</div>
				</section>

				{/* Closing CTA */}
				<section className="mt-20 rounded-3xl border border-lounge-gold/30 bg-lounge-gold/5 px-8 py-12 text-center sm:px-12">
					<p className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
						{BRAND.tagline}
					</p>
					<div className="mt-6 flex flex-wrap items-center justify-center gap-4">
						<Link
							href="/pricing"
							className="rounded-full bg-foreground px-6 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
						>
							Take a seat — see plans
						</Link>
						<Link
							href="/compare"
							className="rounded-full border px-6 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-lounge-gold/60"
						>
							Compare Lounge
						</Link>
					</div>
				</section>
			</div>
		</div>
	);
}
