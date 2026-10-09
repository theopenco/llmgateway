import { ArrowRight, Building2, FileText, ScrollText } from "lucide-react";

import { TrackedLink } from "@/components/home/tracked-link";

const EO_URL =
	"https://www.federalregister.gov/documents/2026/10/02/2026-20321/inaugurating-the-era-of-super-intelligence";

const FACTS = [
	{
		icon: ScrollText,
		label: "Signed",
		value: "September 29, 2026",
		body: "Executive Order 14434, Inaugurating the Era of Super Intelligence.",
	},
	{
		icon: FileText,
		label: "Published",
		value: "October 2, 2026",
		body: "Federal Register, Volume 91, No. 190, pages 63129 to 63130.",
	},
	{
		icon: Building2,
		label: "Applies to",
		value: "Executive branch",
		body: "Agencies' correspondence, websites, reports and other non-statutory documents.",
	},
];

const ROWS = [
	{ area: "Agency websites and reports", before: "AI", after: "SI" },
	{
		area: "Official correspondence",
		before: "Artificial Intelligence",
		after: "Super Intelligence",
	},
	{ area: "Existing regulations", before: "AI", after: "Unchanged" },
	{ area: "Statutes", before: "AI", after: "Unchanged" },
	{ area: "Private companies", before: "AI", after: "Not covered" },
	{
		area: "Model IDs and APIs",
		before: "gpt-5, /v1/chat/completions",
		after: "Unchanged",
	},
];

const FAQS = [
	{
		q: "What is Super Intelligence (SI)?",
		a: "Super Intelligence, or SI, is the term the US executive branch now uses in place of Artificial Intelligence (AI) under Executive Order 14434. It refers to the same technology: large language models and other frontier systems.",
	},
	{
		q: "Does the order apply to private companies?",
		a: "No. It directs executive departments and agencies, to the maximum extent permitted by law. Companies may adopt the term, but they are not required to.",
	},
	{
		q: "Do previously issued regulations change?",
		a: "No. The order states that it does not require altering previously issued regulations or Presidential actions.",
	},
	{
		q: "Do I need to change my code?",
		a: "No. Model IDs, endpoints and SDKs are unchanged. Through LLM Gateway, the same OpenAI-compatible request works with every provider.",
	},
];

export function SuperIntelligenceHero() {
	return (
		<section className="relative overflow-hidden pt-32 pb-16 sm:pt-40 sm:pb-20">
			<div
				aria-hidden
				className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[600px] bg-[radial-gradient(55%_45%_at_50%_0%,rgba(139,92,246,0.18),transparent_70%),radial-gradient(35%_35%_at_15%_25%,rgba(52,211,153,0.12),transparent_70%)]"
			/>
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				<div className="mx-auto max-w-4xl text-center">
					<div className="mb-8 flex items-center justify-center gap-4 font-mono text-5xl font-bold tracking-tight sm:text-7xl">
						<span className="text-muted-foreground/50 line-through decoration-2">
							AI
						</span>
						<ArrowRight className="h-8 w-8 text-muted-foreground sm:h-10 sm:w-10" />
						<span className="bg-gradient-to-r from-violet-400 to-sky-400 bg-clip-text text-transparent">
							SI
						</span>
					</div>
					<h1 className="mb-6 text-4xl font-bold tracking-tight text-balance sm:text-6xl">
						Super Intelligence, explained
					</h1>
					<p className="mx-auto max-w-2xl text-lg leading-relaxed text-balance text-muted-foreground sm:text-xl">
						Executive Order 14434 tells federal agencies to say Super
						Intelligence (SI) instead of Artificial Intelligence (AI). Here is
						what changed, what did not, and what it means for teams building
						with models.
					</p>
				</div>
			</div>
		</section>
	);
}

export function SuperIntelligenceFacts() {
	return (
		<section className="py-12">
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				<div className="mx-auto grid max-w-5xl gap-5 md:grid-cols-3">
					{FACTS.map((fact) => (
						<div
							key={fact.label}
							className="rounded-xl border border-border bg-card p-6"
						>
							<div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
								<fact.icon className="h-4 w-4" />
								{fact.label}
							</div>
							<div className="mb-2 text-xl font-semibold">{fact.value}</div>
							<p className="text-sm leading-relaxed text-muted-foreground">
								{fact.body}
							</p>
						</div>
					))}
				</div>
				<div className="mt-6 text-center">
					<TrackedLink
						href={EO_URL}
						location="super_intelligence_facts"
						cta="read_executive_order"
						external
						className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
					>
						Read the full order on the Federal Register
						<ArrowRight className="h-3.5 w-3.5" />
					</TrackedLink>
				</div>
			</div>
		</section>
	);
}

export function SuperIntelligenceChanges() {
	return (
		<section className="py-20">
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				<div className="mx-auto max-w-4xl">
					<h2 className="mb-4 text-center text-3xl font-bold tracking-tight text-balance sm:text-4xl">
						What changes, and what does not
					</h2>
					<p className="mx-auto mb-10 max-w-2xl text-center text-lg text-balance text-muted-foreground">
						The order changes words in government documents. It does not change
						the technology or your integration.
					</p>
					<div className="overflow-hidden rounded-xl border border-border">
						<table className="w-full text-left text-sm">
							<thead className="bg-muted/50 text-muted-foreground">
								<tr>
									<th className="px-4 py-3 font-medium">Area</th>
									<th className="px-4 py-3 font-medium">Before</th>
									<th className="px-4 py-3 font-medium">Now</th>
								</tr>
							</thead>
							<tbody>
								{ROWS.map((row) => (
									<tr key={row.area} className="border-t border-border">
										<td className="px-4 py-3 font-medium">{row.area}</td>
										<td className="px-4 py-3 font-mono text-xs text-muted-foreground sm:text-sm">
											{row.before}
										</td>
										<td className="px-4 py-3 font-mono text-xs sm:text-sm">
											{row.after}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			</div>
		</section>
	);
}

export function SuperIntelligenceGatewayPitch() {
	return (
		<section className="py-12">
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				<div className="mx-auto grid max-w-5xl items-center gap-8 rounded-2xl border border-border bg-card p-8 sm:p-12 md:grid-cols-[1.4fr_1fr]">
					<div>
						<h2 className="mb-4 text-2xl font-bold tracking-tight sm:text-3xl">
							Build on SI with one gateway
						</h2>
						<p className="text-muted-foreground">
							LLM Gateway is an SI gateway: one OpenAI-compatible API for every
							major Super Intelligence provider, with failover, cost tracking
							and audit-ready logs.
						</p>
					</div>
					<div className="flex flex-col gap-3">
						<TrackedLink
							href="/si-gateway"
							location="super_intelligence_pitch"
							cta="explore_si_gateway"
							className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
						>
							Explore SI Gateway
							<ArrowRight className="ml-2 h-4 w-4" />
						</TrackedLink>
						<TrackedLink
							href="/blog/si-gateway"
							location="super_intelligence_pitch"
							cta="read_blog_post"
							className="inline-flex h-11 items-center justify-center rounded-md border border-border px-6 text-sm font-medium transition-colors hover:bg-muted"
						>
							Read the full breakdown
						</TrackedLink>
					</div>
				</div>
			</div>
		</section>
	);
}

export function SuperIntelligenceFaq() {
	const jsonLd = {
		"@context": "https://schema.org",
		"@type": "FAQPage",
		mainEntity: FAQS.map((faq) => ({
			"@type": "Question",
			name: faq.q,
			acceptedAnswer: { "@type": "Answer", text: faq.a },
		})),
	};

	return (
		<section className="py-20">
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
			/>
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				<div className="mx-auto max-w-3xl">
					<h2 className="mb-10 text-center text-3xl font-bold tracking-tight sm:text-4xl">
						Frequently asked questions
					</h2>
					<div className="divide-y divide-border rounded-xl border border-border">
						{FAQS.map((faq) => (
							<details key={faq.q} className="group p-6">
								<summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
									{faq.q}
									<span className="text-muted-foreground transition-transform group-open:rotate-45">
										+
									</span>
								</summary>
								<p className="mt-3 text-sm leading-relaxed text-muted-foreground">
									{faq.a}
								</p>
							</details>
						))}
					</div>
				</div>
			</div>
		</section>
	);
}
