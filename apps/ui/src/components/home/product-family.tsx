import { ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils";

import { MARKETING_STATS } from "@llmgateway/shared";

import { editorial } from "./fonts";
import styles from "./home.module.css";
import { ProductSlider, type Slide } from "./product-slider";
import { TrackedLink } from "./tracked-link";

const SLIDE_WIDTH = 1120;
const SLIDE_HEIGHT = 560;

const DEVPASS_SLIDES: Slide[] = [
	{
		slug: "overview",
		label: "Overview",
		alt: "Coding activity heatmap with a daily streak above the plan's spend and allowance for the month",
	},
	{
		slug: "usage",
		label: "Usage",
		alt: "Cycle totals for spend, requests, tokens and peak day above a 30-day chart of cost per model",
	},
	{
		slug: "billing",
		label: "Billing",
		alt: "Billing history with the plan start, a credits top-up, Reset Passes and a refund, each with its invoice or credit note",
	},
	{
		slug: "census",
		label: "Census",
		alt: "Model Census board ranking coding models by value, with quality, speed and recommend-rate scores",
	},
];

const LOUNGE_SLIDES: Slide[] = [
	{
		slug: "chat",
		label: "Chat",
		alt: "Claude Sonnet 5 answers a request for a make-ahead three-course dinner menu for six with one vegetarian guest",
	},
	{
		slug: "group",
		label: "Group",
		alt: "A group chat where Claude Sonnet 5, Gemini 3.8 Flash and Qwen3.8 Max discuss how to spend a rainy Sunday, with Claude's and Gemini's replies shown",
	},
	{
		slug: "image",
		label: "Image",
		alt: "Gemini 3.1 Flash Image, Gemini 3 Pro Image and Seedream 5.0 Lite watercolor hot air balloon images side by side",
	},
	{
		slug: "video",
		label: "Video",
		alt: "Seedance 1.5 Pro and Seedance 2.0 Mini 5-second koi pond clips side by side",
	},
	{
		slug: "audio",
		label: "Audio",
		alt: "The same line spoken by three text-to-speech models, each with its own audio player",
	},
	{
		slug: "voice",
		label: "Voice",
		alt: "A saved voice call with Gemini 3.1 Flash Live about picnic food and games, with its transcript",
	},
	{
		slug: "canvas",
		label: "Canvas",
		alt: "A generated canvas with a donut chart of a community garden's harvest by crop next to a table of weekly tasks",
	},
];

interface Product {
	gate: string;
	name: string;
	audience: string;
	body: string;
	href: string;
	external?: boolean;
	track: string;
	cta: string;
	accent: string;
	ink: string;
	slug: string;
	activeTone: string;
	slides: Slide[];
	featured?: boolean;
}

const PRODUCTS: Product[] = [
	{
		gate: "A",
		name: "LLM Gateway",
		audience: "Product & platform teams",
		body: `One OpenAI-compatible API for ${MARKETING_STATS.models} models, with routing, caching, failover and cost analytics on every request. Guardrails on Enterprise.`,
		href: "/products/ai-gateway",
		track: "llm_gateway",
		cta: "Explore the gateway",
		accent: "bg-sky-500",
		ink: "text-sky-600 dark:text-sky-300",
		slug: "gateway",
		activeTone:
			"border-sky-500/40 bg-sky-500/15 text-sky-800 dark:text-sky-200",
		slides: [
			{
				slug: "api-keys",
				label: "API Keys",
				alt: "API keys with masked keys, creator, spend against each cap, recurring limits and IAM rules",
			},
			{
				slug: "team",
				label: "Team",
				alt: "Team members with roles, teams, project access, limits, cost, tokens and requests",
			},
			{
				slug: "guardrails",
				label: "Guardrails",
				alt: "Guardrail rules for prompt injection, jailbreaks, secrets, PII, file types and document leakage, each set to block, redact or warn",
			},
			{
				slug: "master-keys",
				label: "Master Keys",
				alt: "Master keys with masked keys, status, creator, creation date and last use",
			},
			{
				slug: "audit-logs",
				label: "Audit Logs",
				alt: "Audit log of API key, master key, project and budget changes with who made them",
			},
		],
		featured: true,
	},
	{
		gate: "B",
		name: "Observability",
		audience: "Platform & finance teams",
		body: "Cost, latency, errors and cache hits on every request, with spend by model, provider and API key, and by project on Enterprise. Full prompts and responses when you turn on data retention.",
		href: "/products/observability",
		track: "observability",
		cta: "See the dashboards",
		accent: "bg-violet-400",
		ink: "text-violet-600 dark:text-violet-300",
		slug: "observability",
		activeTone:
			"border-violet-500/40 bg-violet-500/15 text-violet-800 dark:text-violet-200",
		slides: [
			{
				slug: "activity",
				label: "Activity",
				alt: "Activity log with each request's model, cache status, tokens, duration, cost, source tool and finish reason",
			},
			{
				slug: "request",
				label: "Request",
				alt: "One request's detail with duration, tokens, throughput, time to first token, cost and cache usage",
			},
			{
				slug: "agents",
				label: "Agents",
				alt: "Coding and automation agents such as Claude Code, Cursor, Codex CLI and n8n with their 7-day spend, requests and tokens",
			},
			{
				slug: "usage",
				label: "Costs",
				alt: "Cost split by model in a donut chart for one project over the last 7 days",
			},
			{
				slug: "tokens",
				label: "Tokens",
				alt: "Input, cache-read and output tokens charted per day for the last 7 days",
			},
			{
				slug: "key-usage",
				label: "Key usage",
				alt: "Daily requests stacked by API key for one project",
			},
		],
	},
	{
		gate: "C",
		name: "DevPass",
		audience: "Developers",
		body: "Flat-price plans for AI coding. One key for your coding tools, included model usage, and every request tracked by tool in one dashboard.",
		href: "https://devpass.llmgateway.io",
		external: true,
		track: "devpass",
		cta: "Get a DevPass",
		accent: "bg-emerald-500",
		ink: "text-emerald-600 dark:text-emerald-300",
		slug: "devpass",
		activeTone:
			"border-emerald-500/40 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200",
		slides: DEVPASS_SLIDES,
	},
	{
		gate: "D",
		name: "Lounge",
		audience: "Everyone at work",
		body: "Chat with GPT, Claude and Gemini, create images, video and speech, and run group chats with several models. Fast models from $9/mo, flagship models from $19/mo.",
		href: "https://lounge.llmgateway.io",
		external: true,
		track: "lounge",
		cta: "Enter the Lounge",
		accent: "bg-amber-400",
		ink: "text-amber-600 dark:text-amber-300",
		slug: "lounge",
		activeTone:
			"border-amber-500/40 bg-amber-500/15 text-amber-800 dark:text-amber-200",
		slides: LOUNGE_SLIDES,
	},
	{
		gate: "E",
		name: "AirSide",
		audience: "Inference providers",
		body: "List your models on LLM Gateway, file your prices, pass review and compete for traffic from teams across the network.",
		href: "https://airside.llmgateway.io",
		external: true,
		track: "airside",
		cta: "List your models",
		accent: "bg-rose-500",
		ink: "text-rose-600 dark:text-rose-300",
		slug: "airside",
		activeTone:
			"border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-200",
		slides: [
			{
				slug: "operations",
				label: "Operations",
				alt: "30-day totals for requests, tokens out and billed traffic above a daily traffic chart",
			},
			{
				slug: "fleet",
				label: "Fleet",
				alt: "Listed models with their status, context size, fares per million tokens, regions and actions",
			},
			{
				slug: "traffic",
				label: "Traffic",
				alt: "Per-model table of requests, errors, tokens out and billed traffic, including regional variants",
			},
			{
				slug: "file-fare",
				label: "Fares",
				alt: "Dialog for filing a new fare with input, output, cached input and per-request prices",
			},
			{
				slug: "filings",
				label: "Filings",
				alt: "Filing history of model listings and fare changes with prices, review status and notes",
			},
			{
				slug: "verify",
				label: "Verify",
				alt: "Verification dialog with passed checks for completion, streaming, tool calls and JSON output, and its run history",
			},
		],
	},
];

function Screenshot({ product }: { product: Product }) {
	const { featured } = product;

	return (
		<div
			className={cn(
				"relative flex flex-col justify-end overflow-hidden rounded-t-[15px] border-b border-border bg-muted/60 px-5 pt-5 lg:px-8 lg:pt-8",
				featured &&
					"lg:order-last lg:rounded-t-none lg:rounded-tr-[15px] lg:border-b-0 lg:border-l lg:pt-10 lg:pr-0 lg:pl-10",
			)}
		>
			<div
				aria-hidden
				className={cn(
					"pointer-events-none absolute -top-32 left-1/2 size-80 -translate-x-1/2 rounded-full opacity-20 blur-3xl dark:opacity-25",
					product.accent,
				)}
			/>
			<ProductSlider
				product={product.slug}
				slides={product.slides}
				width={SLIDE_WIDTH}
				height={SLIDE_HEIGHT}
				activeTone={product.activeTone}
				frameClassName={
					featured ? "lg:rounded-tr-none lg:border-r-0" : undefined
				}
			/>
		</div>
	);
}

function Notch({ side }: { side: "left" | "right" }) {
	return (
		<span
			className={cn(
				"absolute top-1/2 size-6 -translate-y-1/2 rounded-full border border-border bg-background before:absolute before:inset-0 before:rounded-full before:bg-muted/30",
				side === "left"
					? "-left-3 [clip-path:inset(0_0_0_50%)]"
					: "-right-3 [clip-path:inset(0_50%_0_0)]",
			)}
		/>
	);
}

function BoardingPass({ product }: { product: Product }) {
	return (
		<article
			className={cn(
				"group relative flex min-w-0 flex-col rounded-2xl border border-border bg-card transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_30px_60px_-30px_rgba(0,0,0,0.35)]",
				product.featured && "md:col-span-2",
			)}
		>
			<div
				className={cn(
					"flex flex-1 flex-col",
					product.featured &&
						"lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]",
				)}
			>
				<Screenshot product={product} />
				<div
					className={cn(
						"flex flex-1 flex-col p-6 md:p-8",
						product.featured && "lg:justify-center lg:p-10",
					)}
				>
					<div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
						<span className={cn("size-2 rounded-full", product.accent)} />
						{product.audience}
					</div>
					<h3
						className={cn(
							"mt-5 font-display text-3xl font-bold tracking-tight md:text-4xl",
							product.featured && "lg:text-5xl",
						)}
					>
						{product.name}
					</h3>
					<p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground md:text-base">
						{product.body}
					</p>
				</div>
			</div>

			<div aria-hidden className="relative h-6">
				<Notch side="left" />
				<span
					className={cn(
						"absolute inset-x-6 top-1/2 h-1.5 -translate-y-1/2 text-foreground/25",
						styles.perforation,
					)}
				/>
				<Notch side="right" />
			</div>

			<div className="flex items-center gap-4 px-6 pt-3 pb-6 md:px-8 md:pb-7">
				<div className="flex shrink-0 items-end gap-2">
					<span
						className={cn(
							editorial.className,
							"text-5xl leading-[0.8]",
							product.ink,
						)}
					>
						{product.gate}
					</span>
					<span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
						Gate
					</span>
				</div>
				<span
					aria-hidden
					className={cn(
						"h-7 min-w-0 max-w-24 flex-1 text-foreground/60",
						styles.barcode,
					)}
				/>
				<TrackedLink
					href={product.href}
					external={product.external}
					location="home_products"
					cta={product.track}
					className={cn(
						"ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-sm text-sm font-semibold after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
						product.ink,
					)}
				>
					{product.cta}
					<ArrowUpRight className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
				</TrackedLink>
			</div>
		</article>
	);
}

export function ProductFamily() {
	return (
		<section className="relative border-y border-border bg-muted/30 py-24 md:py-32">
			<div className="mx-auto max-w-7xl px-4 sm:px-6">
				<div className="max-w-3xl">
					<p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
						The LLM Gateway family
					</p>
					<h2 className="mt-4 font-display text-4xl font-bold leading-[1.08] tracking-[-0.03em] md:text-6xl">
						One terminal.{" "}
						<span
							className={cn(
								editorial.className,
								"font-normal whitespace-nowrap italic",
							)}
						>
							Five gates.
						</span>
					</h2>
					<p className="mt-5 text-lg text-muted-foreground">
						The same routing, billing and trust layer powers every product. Pick
						the gate for the people you&apos;re equipping.
					</p>
				</div>

				<div className="mt-14 grid gap-5 md:grid-cols-2">
					{PRODUCTS.map((product) => (
						<BoardingPass key={product.gate} product={product} />
					))}
				</div>
			</div>
		</section>
	);
}
