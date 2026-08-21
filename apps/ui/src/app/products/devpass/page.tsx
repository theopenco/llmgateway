import {
	CircleDollarSign,
	Gauge,
	KeyRound,
	RefreshCw,
	Terminal,
	Wrench,
} from "lucide-react";

import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import {
	ProductClosingCta,
	ProductFeatureGrid,
	ProductHero,
	ProductScreenshot,
	productJsonLd,
} from "@/components/products/product-sections";

import type { Metadata } from "next";

const DEVPASS_URL = "https://devpass.llmgateway.io";

const title = "DevPass — Flat-Price Dev Plans for AI Coding";
const description =
	"DevPass turns every dollar into $3 of model usage at provider rates. Fixed-price monthly plans for Claude Code, Cursor, Cline, and any OpenAI-compatible coding tool — 200+ models, one API key.";

export const metadata: Metadata = {
	title,
	description,
	alternates: { canonical: "/products/devpass" },
	openGraph: {
		title,
		description,
		url: "https://llmgateway.io/products/devpass",
		type: "website",
	},
};

const features = [
	{
		icon: CircleDollarSign,
		title: "3× usage value",
		description:
			"Every dollar becomes $3 of model usage, metered transparently at provider rates. Lite $29/mo → $87, Pro $79/mo → $237, Max $179/mo → $537.",
	},
	{
		icon: KeyRound,
		title: "One key, every agent",
		description:
			"DevPass Code, Claude Code, OpenCode, Cursor, Cline, Aider, Continue — set two env vars and any OpenAI-compatible tool is stamped in.",
	},
	{
		icon: Terminal,
		title: "Every flagship model",
		description:
			"Claude Opus, GPT-5, Gemini Pro, plus the strongest open-weight coders — switch models freely mid-project with no extra cost.",
	},
	{
		icon: Gauge,
		title: "Real-time metering",
		description:
			"A live dashboard shows per-request cost, model breakdowns, and your remaining allowance — no token math required.",
	},
	{
		icon: RefreshCw,
		title: "Reset Passes",
		description:
			"Burned through your weekly premium allowance? Reset Passes instantly restore it — Pro and Max plans include them every month.",
	},
	{
		icon: Wrench,
		title: "No lock-in",
		description:
			"Runs on the open-source LLM Gateway. Barely used your first month? Refund it yourself from the billing dashboard — no email, no cancellation fee.",
	},
];

export default function DevPassProductPage() {
	const jsonLd = productJsonLd({
		slug: "devpass",
		name: "DevPass",
		description,
	});

	return (
		<>
			{jsonLd.map((schema, i) => (
				<script
					key={i}
					type="application/ld+json"
					// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
					dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
				/>
			))}
			<Navbar />
			<main className="min-h-screen bg-background">
				<ProductHero
					accent="emerald"
					eyebrow="Product · DevPass"
					title="One key. Every model. Three flat prices."
					subtitle="All-access dev plans for AI coding."
					description="DevPass turns every dollar into $3 of model usage at provider rates — metered transparently, with no token math and no lock-in. Best in DevPass Code, our first-party agent, and drop-in for every OpenAI-compatible tool."
					ctas={[
						{ label: "Get DevPass", href: DEVPASS_URL, external: true },
						{
							label: "See pricing",
							href: `${DEVPASS_URL}/pricing`,
							external: true,
							variant: "outline",
						},
					]}
					stats={[
						{ value: "200+", label: "Models" },
						{ value: "3×", label: "Usage value" },
						{ value: "$29/mo", label: "Starting price" },
					]}
				/>

				<div className="mx-auto max-w-6xl space-y-24 px-6 py-20 md:space-y-36 md:py-28">
					<section className="space-y-24 md:space-y-32">
						<ProductScreenshot
							slug="devpass"
							alt="DevPass landing page with flat-price dev plans"
							title="Flat prices, provider rates"
							description="Lite, Pro, and Max — every plan includes 200+ models metered at provider rates, with a self-serve first-month money-back guarantee."
						/>
						<ProductScreenshot
							slug="devpass-dashboard"
							alt="DevPass dashboard showing usage overview and coding agents"
							title="Your coding usage, live"
							description="Track your allowance, per-agent model usage, and activity heatmap from the DevPass dashboard."
						/>
					</section>

					<ProductFeatureGrid title="Why DevPass" features={features} />
				</div>

				<ProductClosingCta
					accent="emerald"
					title="Stop watching your token balance"
					description="Pick a plan, set two env vars, get back to building."
					ctas={[{ label: "Get DevPass", href: DEVPASS_URL, external: true }]}
				/>
			</main>
			<Footer />
		</>
	);
}
