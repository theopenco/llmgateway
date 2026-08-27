import {
	BadgeCheck,
	FileCheck2,
	Gauge,
	PlaneTakeoff,
	Radar,
	ShieldCheck,
	SlidersHorizontal,
	Stamp,
} from "lucide-react";
import Link from "next/link";

import { DepartureBoard } from "@/components/DepartureBoard";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";

import type { Metadata } from "next";

export const metadata: Metadata = {
	alternates: { canonical: "/" },
};

const SITE_URL = "https://airside.llmgateway.io";

const LEGEND = [
	{ term: "Passengers", meaning: "developers" },
	{ term: "Carriers", meaning: "model providers" },
	{ term: "Passports", meaning: "coding agents" },
	{ term: "Visas", meaning: "reset limits" },
];

const STEPS = [
	{
		icon: ShieldCheck,
		title: "Verify your domain",
		body: "Sign up with your company email. When its domain matches your API endpoint's domain, your carrier code unlocks — no sales call, no paperwork.",
	},
	{
		icon: PlaneTakeoff,
		title: "Register your fleet",
		body: "List your models with context, capabilities and launch pricing. New listings are reviewed by the regulator before they enter service.",
	},
	{
		icon: Stamp,
		title: "File your fares",
		body: "Pricing never changes silently. Every price change is a tariff filing — drafted by you, approved by us, and only then in effect.",
	},
	{
		icon: Radar,
		title: "Win traffic",
		body: "Watch your routes fill. Slide your landing fee and discount, and dispatch starts routing more passengers through your gates.",
	},
];

const DISPATCH_WEIGHTS = [
	{
		label: "Fares",
		detail: "price after your discount & landing fee",
		weight: 0.6,
	},
	{
		label: "On-time performance",
		detail: "availability & uptime",
		weight: 0.5,
	},
	{ label: "Cache", detail: "prompt-cache support", weight: 0.2 },
	{ label: "Runway capacity", detail: "throughput", weight: 0.05 },
	{ label: "Taxi time", detail: "latency to first token", weight: 0.025 },
];

const FAQ = [
	{
		q: "Who can claim a carrier?",
		a: "Anyone with a verified email address on the provider's own domain. If your API is served from api.acme.ai, an @acme.ai address claims the acme carrier — that's the whole check, enforced server-side.",
	},
	{
		q: "Can we run more than one carrier?",
		a: "Yes. A company can hold multiple providers — regional deployments, a fast-inference brand and a budget brand — all under one operations console.",
	},
	{
		q: "Why can't we edit prices directly?",
		a: "Because your listed price is what developers are billed. Prices enter service only through an approved tariff filing, so nobody's bill jumps because of a typo at 2am. Everything else about a model you can edit freely.",
	},
	{
		q: "How do we get routed more traffic?",
		a: "Dispatch scores every candidate on fares, on-time performance, runway capacity and taxi time. Cutting your fares, offering a discount, or accepting a lower landing fee lowers your routing score — and lower scores win.",
	},
	{
		q: "What do we see about our traffic?",
		a: "Requests, tokens, billed traffic and estimated payout across every gateway tenant that flies with you — aggregated per model and per day, the same rollups our own operations dashboard reads.",
	},
];

// Emitted as separate top-level blocks rather than one @graph: validators and
// AI parsers routinely read only the root @type of each script.
const JSON_LD = [
	{
		"@context": "https://schema.org",
		"@type": "WebSite",
		"@id": `${SITE_URL}#website`,
		name: "Airside by LLM Gateway",
		url: SITE_URL,
		description:
			"The self-serve console for LLM providers. Claim your carrier, register your fleet, file your fares, and win traffic on LLM Gateway.",
		inLanguage: "en",
		publisher: { "@id": "https://llmgateway.io#organization" },
	},
	{
		"@context": "https://schema.org",
		"@type": "Organization",
		"@id": "https://llmgateway.io#organization",
		name: "LLM Gateway",
		legalName: "Polar Lights LLC",
		url: "https://llmgateway.io",
		email: "contact@llmgateway.io",
		address: {
			"@type": "PostalAddress",
			streetAddress: "16192 Coastal Highway",
			addressLocality: "Lewes",
			addressRegion: "DE",
			postalCode: "19958",
			addressCountry: "US",
		},
		sameAs: ["https://github.com/theopenco/llmgateway"],
	},
	{
		"@context": "https://schema.org",
		"@type": "FAQPage",
		"@id": `${SITE_URL}#faq`,
		mainEntity: FAQ.map((item) => ({
			"@type": "Question",
			name: item.q,
			acceptedAnswer: { "@type": "Answer", text: item.a },
		})),
	},
];

export default function LandingPage() {
	return (
		<div className="flex min-h-screen flex-col">
			{JSON_LD.map((schema) => (
				<script
					key={schema["@id"]}
					type="application/ld+json"
					// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
					dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
				/>
			))}
			<Header />

			<main className="flex-1">
				{/* Hero */}
				<section className="radar-grid relative overflow-hidden">
					<div className="from-background via-background/60 to-background pointer-events-none absolute inset-0 bg-gradient-to-b" />
					<div className="relative mx-auto grid max-w-6xl gap-12 px-4 pt-20 pb-16 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:pt-28 lg:pb-24">
						<div>
							<p className="text-primary mb-4 font-mono text-xs tracking-[0.3em] uppercase">
								The carrier console for LLM Gateway
							</p>
							<h1 className="font-display text-4xl leading-[1.05] font-black tracking-tight text-balance sm:text-5xl lg:text-6xl">
								Put your models on the departure board.
							</h1>
							<p className="text-muted-foreground mt-6 max-w-xl text-lg text-pretty">
								LLM Gateway routes developer traffic across model providers.
								Airside is where providers run the airline: claim your carrier,
								register your fleet, file your fares — and win routes.
							</p>
							<div className="mt-8 flex flex-wrap items-center gap-3">
								<Button asChild size="lg" className="font-semibold">
									<Link href="/signup">Claim your carrier code</Link>
								</Button>
								<Button asChild size="lg" variant="outline">
									<Link href="/#dispatch">See how dispatch routes</Link>
								</Button>
							</div>
							<p className="text-muted-foreground mt-4 font-mono text-xs">
								Self-serve. Verified by your email domain. Live in minutes.
							</p>
						</div>
						<DepartureBoard />
					</div>
				</section>

				<div className="runway-line mx-auto max-w-6xl" />

				{/* Metaphor legend */}
				<section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
					<div className="grid grid-cols-2 gap-6 md:grid-cols-4">
						{LEGEND.map((item) => (
							<div key={item.term} className="text-center">
								<div className="font-display text-lg font-black tracking-tight">
									{item.term}
								</div>
								<div className="text-muted-foreground font-mono text-xs tracking-widest uppercase">
									= {item.meaning}
								</div>
							</div>
						))}
					</div>
					<p className="text-muted-foreground mx-auto mt-6 max-w-2xl text-center text-sm">
						An AI gateway is an airport. Developers land here with their coding
						agents; the gateway routes each of them onto a carrier. Airside is
						the side of the airport where the carriers operate.
					</p>
				</section>

				{/* How it works */}
				<section id="how-it-works" className="border-border/60 border-y">
					<div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
						<h2 className="font-display text-3xl font-black tracking-tight">
							From claim to cleared for takeoff
						</h2>
						<div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
							{STEPS.map((step, i) => (
								<div key={step.title} className="relative">
									<div className="text-primary mb-3 flex items-center gap-3">
										<step.icon className="size-5" />
										<span className="font-mono text-xs tracking-[0.25em]">
											{String(i + 1).padStart(2, "0")}
										</span>
									</div>
									<h3 className="font-display text-lg font-bold">
										{step.title}
									</h3>
									<p className="text-muted-foreground mt-2 text-sm">
										{step.body}
									</p>
								</div>
							))}
						</div>
					</div>
				</section>

				{/* Dispatch / routing explainer */}
				<section id="dispatch" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
					<div className="grid gap-10 lg:grid-cols-2 lg:items-center">
						<div>
							<p className="text-primary mb-3 font-mono text-xs tracking-[0.3em] uppercase">
								Dispatch — the smart routing election
							</p>
							<h2 className="font-display text-3xl font-black tracking-tight">
								Routing is an auction you can actually see.
							</h2>
							<p className="text-muted-foreground mt-4">
								For every request, dispatch scores each eligible carrier and the
								lowest score wins the passenger. Your fares carry the most
								weight — the price after your discount and the landing fee (our
								margin) you accept — followed by on-time performance
								(availability), runway capacity (throughput) and taxi time
								(latency).
							</p>
							<p className="text-muted-foreground mt-3">
								That means the controls in this console are not cosmetic:
								cutting a fare, filing a lower tariff, or accepting a smaller
								landing fee measurably moves traffic to your gates.
							</p>
						</div>
						<div className="border-border bg-card rounded-xl border p-6">
							<div className="text-muted-foreground mb-4 font-mono text-[0.65rem] tracking-[0.25em] uppercase">
								Dispatch scoring weights
							</div>
							<div className="space-y-4">
								{DISPATCH_WEIGHTS.map((w) => (
									<div key={w.label}>
										<div className="mb-1 flex items-baseline justify-between gap-2">
											<span className="text-sm font-medium">{w.label}</span>
											<span className="text-muted-foreground font-mono text-xs">
												{w.detail}
											</span>
										</div>
										<div className="bg-muted h-2 overflow-hidden rounded-full">
											<div
												className="bg-primary h-full rounded-full"
												style={{ width: `${(w.weight / 0.6) * 100}%` }}
											/>
										</div>
									</div>
								))}
							</div>
						</div>
					</div>
				</section>

				{/* Regulation / fare filing */}
				<section className="border-border/60 border-y">
					<div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-3">
						<div className="lg:col-span-1">
							<p className="text-primary mb-3 font-mono text-xs tracking-[0.3em] uppercase">
								Regulated, on purpose
							</p>
							<h2 className="font-display text-3xl font-black tracking-tight">
								Your fleet, our tower.
							</h2>
							<p className="text-muted-foreground mt-4 text-sm">
								Airside exists to bring smaller and local-model providers onto
								the gateway without a sales cycle — and without letting billing
								surprises onto the runway.
							</p>
						</div>
						<div className="grid gap-6 sm:grid-cols-2 lg:col-span-2">
							{[
								{
									icon: BadgeCheck,
									title: "You control the fleet",
									body: "Add models, edit capabilities, delist retired aircraft — instantly, no review needed.",
								},
								{
									icon: FileCheck2,
									title: "We clear the tariffs",
									body: "Initial listings and every later price change land in our approval queue before taking effect.",
								},
								{
									icon: SlidersHorizontal,
									title: "You set the economics",
									body: "Slide your discount and the landing fee you accept; the routing boost applies immediately.",
								},
								{
									icon: Gauge,
									title: "You watch it fly",
									body: "Requests, tokens, billed traffic and estimated payout, per model and per day.",
								},
							].map((card) => (
								<div
									key={card.title}
									className="border-border bg-card rounded-xl border p-5"
								>
									<card.icon className="text-primary mb-3 size-5" />
									<h3 className="font-display font-bold">{card.title}</h3>
									<p className="text-muted-foreground mt-1.5 text-sm">
										{card.body}
									</p>
								</div>
							))}
						</div>
					</div>
				</section>

				{/* FAQ */}
				<section id="faq" className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
					<h2 className="font-display text-3xl font-black tracking-tight">
						Pre-flight questions
					</h2>
					<dl className="mt-8 space-y-8">
						{FAQ.map((item) => (
							<div key={item.q}>
								<dt className="font-display font-bold">{item.q}</dt>
								<dd className="text-muted-foreground mt-2 text-sm">{item.a}</dd>
							</div>
						))}
					</dl>
				</section>

				{/* Final CTA */}
				<section className="border-border/60 border-t">
					<div className="mx-auto max-w-6xl px-4 py-20 text-center sm:px-6">
						<h2 className="font-display text-4xl font-black tracking-tight text-balance">
							The board updates every minute.
							<br />
							Get your fleet on it.
						</h2>
						<div className="mt-8 flex justify-center">
							<Button asChild size="lg" className="font-semibold">
								<Link href="/signup">Claim your carrier code</Link>
							</Button>
						</div>
						<p className="text-muted-foreground mt-4 font-mono text-xs">
							Free to claim — you only ever share margin on traffic you win.
						</p>
					</div>
				</section>
			</main>

			<Footer />
		</div>
	);
}
