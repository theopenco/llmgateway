import {
	Building2,
	ClipboardCheck,
	Database,
	FileSearch,
	PlaneTakeoff,
	RefreshCcw,
	ShieldCheck,
	Stamp,
} from "lucide-react";
import Link from "next/link";

import { CertificateSpecimen } from "@/components/airworthy/CertificateSpecimen";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { getConfig } from "@/lib/config-server";

import { countryCodeToFlag } from "@llmgateway/models";
import {
	AirworthyStamp,
	fetchProvidersFromApi,
} from "@llmgateway/shared/components";
import { JsonLd } from "@llmgateway/shared/json-ld";

import type { Metadata } from "next";

const SITE_URL = "https://airside.llmgateway.io";
const PAGE_URL = `${SITE_URL}/airworthy`;
const INSPECTION_MAILTO =
	"mailto:contact@llmgateway.io?subject=Airworthy%20inspection%20request";

const TITLE = "Airworthy: the certificate for LLM inference providers";
const DESCRIPTION =
	"Airworthy (standard AW-1) certifies that an inference provider's claims on AI training, prompt logging, data retention, headquarters and audits were checked against evidence by LLM Gateway.";

export const metadata: Metadata = {
	title: TITLE,
	description: DESCRIPTION,
	alternates: { canonical: "/airworthy" },
	openGraph: { title: TITLE, url: "/airworthy", description: DESCRIPTION },
	twitter: { title: TITLE, description: DESCRIPTION },
};

const DOMAINS = [
	{
		code: "D",
		icon: Database,
		title: "Data handling",
		lede: "What happens to a prompt after it leaves the gateway.",
		controls: [
			{
				id: "AW-1.D1",
				claim: "We don't train on your API data.",
				evidence:
					"The training clause in the signed DPA or the terms of service.",
			},
			{
				id: "AW-1.D2",
				claim: "We don't log prompts.",
				evidence: "The logging scope in the DPA or privacy policy.",
			},
			{
				id: "AW-1.D3",
				claim: "Zero data retention.",
				evidence:
					"The retention period in the DPA, confirmed in writing by the provider.",
			},
		],
	},
	{
		code: "J",
		icon: Building2,
		title: "Jurisdiction",
		lede: "Whose laws the provider answers to.",
		controls: [
			{
				id: "AW-1.J1",
				claim: "Operated by a named legal entity.",
				evidence:
					"A corporate registry extract that matches the contracting party.",
			},
			{
				id: "AW-1.J2",
				claim: "Headquartered in the stated country.",
				evidence: "The registered address in that registry.",
			},
		],
	},
	{
		code: "A",
		icon: ShieldCheck,
		title: "Assurance",
		lede: "Audits that exist on paper, not only as a logo.",
		controls: [
			{
				id: "AW-1.A1",
				claim: "SOC 2 Type I or Type II.",
				evidence:
					"A current report, with its period ending in the last 12 months.",
			},
			{
				id: "AW-1.A2",
				claim: "ISO/IEC 27001 certified.",
				evidence: "The certificate, checked with the body that issued it.",
			},
			{
				id: "AW-1.A3",
				claim: "GDPR ready.",
				evidence:
					"A published DPA with standard contractual clauses, or an EU establishment.",
			},
		],
	},
];

const STEPS = [
	{
		icon: PlaneTakeoff,
		title: "File the profile",
		body: "List as a carrier on Airside and complete the public profile: legal entity, headquarters, training, logging, retention and audits. These are the claims we inspect.",
	},
	{
		icon: FileSearch,
		title: "Inspection",
		body: "Send the evidence: DPA, terms, registry extract, audit reports. An LLM Gateway reviewer checks every claim against it and records what was seen.",
	},
	{
		icon: Stamp,
		title: "Certificate issued",
		body: "You get a numbered AW-1 certificate, valid for 12 months. The stamp goes on your provider page on llmgateway.io and into the public registry below.",
	},
	{
		icon: RefreshCcw,
		title: "Stays true or comes off",
		body: "The certificate freezes the claims it attests. Change one on your profile and the stamp comes off on its own until we inspect again. No stale badges.",
	},
];

const COMPARISON = {
	columns: ["Self-declared profile", "SOC 2 / ISO 27001", "Airworthy AW-1"],
	rows: [
		{
			label: "Who checks it",
			values: ["Nobody", "An independent auditor", "LLM Gateway reviewers"],
		},
		{
			label: "Says whether prompts train models",
			values: ["Claimed", "Usually out of scope", "Checked against the DPA"],
		},
		{
			label: "Says how long prompts are kept",
			values: [
				"Claimed",
				"Rarely in scope",
				"Checked, zero retention confirmed",
			],
		},
		{
			label: "Confirms headquarters and entity",
			values: [
				"Claimed",
				"Named in the report",
				"Checked against the registry",
			],
		},
		{
			label: "Shown where you pick a provider",
			values: ["Yes", "Behind an NDA", "On the provider page"],
		},
		{
			label: "When the claim changes",
			values: [
				"Edited silently",
				"Next audit cycle",
				"Stamp comes off at once",
			],
		},
	],
};

const FAQ = [
	{
		q: "What does Airworthy certify?",
		a: "That the provider's public claims about AI training on API data, prompt logging, data retention, legal entity, headquarters, GDPR, SOC 2 and ISO 27001 match the evidence LLM Gateway reviewed. Each certificate lists exactly which claims it attests.",
	},
	{
		q: "Is Airworthy a replacement for SOC 2 or ISO 27001?",
		a: "No. Those audit a company's security controls. Airworthy checks the specific promises an inference API makes about your prompts and where it operates, and it confirms that any SOC 2 or ISO 27001 claim is backed by a current report or certificate.",
	},
	{
		q: "Who can be certified?",
		a: "Any carrier listed on Airside with a complete public profile. Catalogue providers and custom carriers go through the same inspection.",
	},
	{
		q: "How long is a certificate valid?",
		a: "Twelve months from issue. It ends sooner if the carrier changes an attested claim or LLM Gateway revokes it, and the stamp disappears from the provider page the moment that happens.",
	},
	{
		q: "How do I check a certificate?",
		a: "Every valid certificate is listed in the registry on this page with its number and expiry, and the same number is printed on the stamp on the provider page.",
	},
	{
		q: "How do we apply?",
		a: "List your carrier on Airside, complete your profile, then request an inspection. We will tell you which documents to send.",
	},
];

const JSON_LD = [
	{
		"@context": "https://schema.org",
		"@type": "WebPage",
		"@id": `${PAGE_URL}#webpage`,
		name: TITLE,
		url: PAGE_URL,
		description: DESCRIPTION,
		isPartOf: { "@id": `${SITE_URL}#website` },
		publisher: { "@id": "https://llmgateway.io#organization" },
	},
	{
		"@context": "https://schema.org",
		"@type": "FAQPage",
		"@id": `${PAGE_URL}#faq`,
		mainEntity: FAQ.map((item) => ({
			"@type": "Question",
			name: item.q,
			acceptedAnswer: { "@type": "Answer", text: item.a },
		})),
	},
];

function formatValidUntil(iso: string) {
	return new Date(iso)
		.toLocaleDateString("en-US", {
			day: "2-digit",
			month: "short",
			year: "numeric",
			timeZone: "UTC",
		})
		.toUpperCase();
}

export default async function AirworthyPage() {
	const config = getConfig();
	const providers = await fetchProvidersFromApi(config.apiBackendUrl);
	const certified = providers
		.flatMap((provider) =>
			provider.airsideCertification
				? [{ provider, certification: provider.airsideCertification }]
				: [],
		)
		.sort((a, b) =>
			(a.provider.name ?? a.provider.id).localeCompare(
				b.provider.name ?? b.provider.id,
			),
		);

	return (
		<div className="flex min-h-screen flex-col">
			{JSON_LD.map((schema) => (
				<JsonLd key={schema["@id"]} data={schema} />
			))}
			<Header />

			<main className="flex-1">
				<section className="radar-grid relative overflow-hidden">
					<div className="from-background via-background/70 to-background pointer-events-none absolute inset-0 bg-gradient-to-b" />
					<div className="relative mx-auto grid max-w-6xl gap-16 px-4 pt-20 pb-24 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:pt-28">
						<div>
							<p className="text-primary mb-5 inline-flex items-center gap-3 font-mono text-xs tracking-[0.3em] uppercase">
								<span className="border-primary/50 rounded-sm border px-1.5 py-0.5 tracking-[0.2em]">
									AW-1
								</span>
								Airworthy certification
							</p>
							<h1 className="font-display text-4xl leading-[1.02] font-black tracking-tight text-balance sm:text-5xl lg:text-[4rem]">
								Self-declared
								<br />
								isn't verified.
							</h1>
							<p className="text-muted-foreground mt-6 max-w-xl text-lg text-pretty">
								Every inference provider says it doesn't train on your prompts.
								Airworthy tells you which ones proved it. We check each claim on
								training, retention, headquarters and audits against contracts,
								registries and reports, then stamp the provider page.
							</p>
							<div className="mt-8 flex flex-wrap items-center gap-3">
								<Button asChild size="lg" className="font-semibold">
									<a href={INSPECTION_MAILTO}>Request an inspection</a>
								</Button>
								<Button asChild size="lg" variant="outline">
									<Link href="#registry">See certified carriers</Link>
								</Button>
							</div>
							<p className="text-muted-foreground mt-4 font-mono text-xs">
								For carriers listed on Airside. Valid 12 months. Revoked the
								moment a claim changes.
							</p>
						</div>
						<CertificateSpecimen className="lg:ml-auto" />
					</div>
				</section>

				<div className="runway-line mx-auto max-w-6xl" />

				<section id="standard" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
					<div className="grid gap-6 lg:grid-cols-[1fr_2fr] lg:items-end">
						<div>
							<p className="text-primary mb-3 font-mono text-xs tracking-[0.3em] uppercase">
								The standard
							</p>
							<h2 className="font-display text-3xl font-black tracking-tight sm:text-4xl">
								Eight claims. Each one checked against paper.
							</h2>
						</div>
						<p className="text-muted-foreground max-w-2xl lg:justify-self-end">
							AW-1 covers the promises developers and compliance teams actually
							ask about before sending a prompt to a new provider. A claim that
							can't be backed by a document doesn't make it onto the
							certificate.
						</p>
					</div>
					<div className="mt-12 grid gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-3">
						{DOMAINS.map((domain) => (
							<div key={domain.code} className="bg-card flex flex-col p-6">
								<div className="flex items-center justify-between">
									<domain.icon className="text-primary size-5" />
									<span className="text-muted-foreground font-mono text-xs tracking-[0.25em]">
										AW-1.{domain.code}
									</span>
								</div>
								<h3 className="font-display mt-4 text-xl font-black">
									{domain.title}
								</h3>
								<p className="text-muted-foreground mt-1 text-sm">
									{domain.lede}
								</p>
								<ol className="mt-6 space-y-5">
									{domain.controls.map((control) => (
										<li key={control.id} className="border-l-2 pl-4">
											<div className="text-primary font-mono text-[0.7rem] tracking-widest">
												{control.id}
											</div>
											<div className="mt-1 font-medium">“{control.claim}”</div>
											<div className="text-muted-foreground mt-1 flex gap-2 text-sm">
												<ClipboardCheck className="mt-0.5 size-3.5 shrink-0" />
												<span>{control.evidence}</span>
											</div>
										</li>
									))}
								</ol>
							</div>
						))}
					</div>
				</section>

				<section
					id="how-it-works"
					className="border-border/60 bg-card/40 border-y"
				>
					<div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
						<p className="text-primary mb-3 font-mono text-xs tracking-[0.3em] uppercase">
							Flight plan
						</p>
						<h2 className="font-display text-3xl font-black tracking-tight sm:text-4xl">
							From profile to stamp
						</h2>
						<ol className="relative mt-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
							<div
								aria-hidden="true"
								className="runway-line absolute top-[0.6rem] right-0 left-0 hidden lg:block"
							/>
							{STEPS.map((step, i) => (
								<li key={step.title} className="relative">
									<div className="bg-background text-primary relative mb-4 inline-flex items-center gap-3 pr-3">
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
								</li>
							))}
						</ol>
					</div>
				</section>

				<section id="registry" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
					<div className="flex flex-wrap items-end justify-between gap-6">
						<div>
							<p className="text-primary mb-3 font-mono text-xs tracking-[0.3em] uppercase">
								Public registry
							</p>
							<h2 className="font-display text-3xl font-black tracking-tight sm:text-4xl">
								Cleared carriers
							</h2>
							<p className="text-muted-foreground mt-3 max-w-xl">
								Every certificate in force right now. If a carrier isn't on this
								board, its stamp isn't valid.
							</p>
						</div>
						<AirworthyStamp
							className="text-primary hidden h-28 w-28 -rotate-12 opacity-80 sm:block"
							aria-hidden="true"
						/>
					</div>
					<div className="mt-10 overflow-hidden rounded-xl border bg-[oklch(0.17_0.018_252)] font-mono text-[oklch(0.93_0.012_85)] shadow-xl">
						<div className="grid grid-cols-[1.4fr_1.2fr_0.6fr_1fr] gap-4 border-b border-white/10 px-5 py-3 text-[0.65rem] tracking-[0.25em] text-white/50 uppercase max-sm:grid-cols-[1.4fr_1fr]">
							<span>Carrier</span>
							<span>Certificate</span>
							<span className="max-sm:hidden">HQ</span>
							<span className="text-right max-sm:hidden">Valid until</span>
						</div>
						{certified.length === 0 ? (
							<div className="px-5 py-10 text-center">
								<div className="text-sm tracking-[0.2em] text-[oklch(0.8_0.15_78)] uppercase">
									Board opening
								</div>
								<p className="mx-auto mt-2 max-w-md font-sans text-sm text-white/60">
									The first inspections are underway. Certified carriers appear
									here the moment their certificate is issued.
								</p>
							</div>
						) : (
							<ul>
								{certified.map(({ provider, certification }) => (
									<li
										key={provider.id}
										className="border-b border-white/5 last:border-b-0"
									>
										<a
											href={`${config.uiUrl}/providers/${provider.id}`}
											className="grid grid-cols-[1.4fr_1.2fr_0.6fr_1fr] items-center gap-4 px-5 py-3.5 text-sm tracking-[0.12em] uppercase transition-colors hover:bg-white/5 max-sm:grid-cols-[1.4fr_1fr]"
										>
											<span className="truncate font-semibold">
												{provider.name ?? provider.id}
											</span>
											<span className="text-[oklch(0.8_0.15_78)]">
												{certification.certificateNumber}
											</span>
											<span className="max-sm:hidden">
												{certification.attested.headquarters
													? `${countryCodeToFlag(certification.attested.headquarters)} ${certification.attested.headquarters}`
													: "—"}
											</span>
											<span className="text-right text-[oklch(0.75_0.16_155)] max-sm:hidden">
												{formatValidUntil(certification.expiresAt)}
											</span>
										</a>
									</li>
								))}
							</ul>
						)}
					</div>
				</section>

				<section className="border-border/60 border-y">
					<div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
						<p className="text-primary mb-3 font-mono text-xs tracking-[0.3em] uppercase">
							Where it fits
						</p>
						<h2 className="font-display max-w-2xl text-3xl font-black tracking-tight sm:text-4xl">
							Audits cover the company. Airworthy covers your prompts.
						</h2>
						<div className="mt-10 overflow-x-auto">
							<table className="w-full min-w-[640px] border-collapse text-left text-sm">
								<thead>
									<tr className="border-b">
										<th className="py-3 pr-4 font-normal" />
										{COMPARISON.columns.map((column, index) => (
											<th
												key={column}
												scope="col"
												className={
													index === COMPARISON.columns.length - 1
														? "bg-primary/10 text-primary rounded-t-lg px-4 py-3 font-display font-black"
														: "text-muted-foreground px-4 py-3 font-semibold"
												}
											>
												{column}
											</th>
										))}
									</tr>
								</thead>
								<tbody>
									{COMPARISON.rows.map((row) => (
										<tr key={row.label} className="border-b last:border-b-0">
											<th scope="row" className="py-3 pr-4 font-medium">
												{row.label}
											</th>
											{row.values.map((value, index) => (
												<td
													key={COMPARISON.columns[index]}
													className={
														index === row.values.length - 1
															? "bg-primary/10 px-4 py-3 font-medium"
															: "text-muted-foreground px-4 py-3"
													}
												>
													{value}
												</td>
											))}
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>
				</section>

				<section className="mx-auto grid max-w-6xl gap-6 px-4 py-20 sm:px-6 md:grid-cols-2">
					<div className="bg-card rounded-xl border p-7">
						<p className="text-muted-foreground font-mono text-xs tracking-[0.25em] uppercase">
							For developers and compliance teams
						</p>
						<h3 className="font-display mt-3 text-2xl font-black">
							Pick a provider without a security questionnaire.
						</h3>
						<p className="text-muted-foreground mt-3 text-sm">
							The stamp on a provider page means someone read the DPA so you
							don't have to. The certificate number tells your reviewer exactly
							which claims were checked and until when.
						</p>
						<Button asChild variant="outline" className="mt-6">
							<a href={`${config.uiUrl}/providers`}>Browse providers</a>
						</Button>
					</div>
					<div className="bg-card rounded-xl border p-7">
						<p className="text-muted-foreground font-mono text-xs tracking-[0.25em] uppercase">
							For carriers
						</p>
						<h3 className="font-display mt-3 text-2xl font-black">
							Turn your privacy policy into a selling point.
						</h3>
						<p className="text-muted-foreground mt-3 text-sm">
							You already did the work: the DPA, the zero-retention setup, the
							audit. Airworthy puts it on your provider page in a form a buyer
							can trust at a glance.
						</p>
						<Button asChild className="mt-6">
							<a href={INSPECTION_MAILTO}>Request an inspection</a>
						</Button>
					</div>
				</section>

				<section id="faq" className="border-border/60 border-t">
					<div className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
						<h2 className="font-display text-3xl font-black tracking-tight">
							Inspection questions
						</h2>
						<dl className="mt-8 space-y-8">
							{FAQ.map((item) => (
								<div key={item.q}>
									<dt className="font-display font-bold">{item.q}</dt>
									<dd className="text-muted-foreground mt-2 text-sm">
										{item.a}
									</dd>
								</div>
							))}
						</dl>
					</div>
				</section>

				<section className="radar-grid border-border/60 relative overflow-hidden border-t">
					<div className="relative mx-auto flex max-w-6xl flex-col items-center px-4 py-24 text-center sm:px-6">
						<AirworthyStamp
							className="text-primary h-32 w-32 -rotate-12"
							aria-hidden="true"
						/>
						<h2 className="font-display mt-8 text-4xl font-black tracking-tight text-balance">
							Prove it once. Wear the stamp.
						</h2>
						<p className="text-muted-foreground mt-4 max-w-xl">
							Not listed yet? Claim your carrier first, then request an
							inspection from the same team that reviews your fares.
						</p>
						<div className="mt-8 flex flex-wrap justify-center gap-3">
							<Button asChild size="lg" className="font-semibold">
								<a href={INSPECTION_MAILTO}>Request an inspection</a>
							</Button>
							<Button asChild size="lg" variant="outline">
								<Link href="/signup">Claim your carrier code</Link>
							</Button>
						</div>
					</div>
				</section>
			</main>
			<Footer />
		</div>
	);
}
