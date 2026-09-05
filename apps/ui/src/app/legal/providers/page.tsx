import { AlertCircle, Check, ExternalLink, Minus, X } from "lucide-react";
import Link from "next/link";

import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { activeModelCounts, listedProviders } from "@/lib/providers-catalog";

import {
	PROVIDER_COUNTRY_NAMES,
	countryCodeToFlag,
	type ProviderDataPolicy,
	type ProviderDefinition,
	type ProviderId,
} from "@llmgateway/models";
import { providerLogoUrls } from "@llmgateway/shared/components";

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
	title: "AI Provider Legal Information",
	description:
		"Review contracting entities, legal, privacy, acceptable use, data retention, location, and compliance information for every publicly listed AI provider available through LLM Gateway.",
	alternates: { canonical: "/legal/providers" },
	openGraph: {
		title: "AI Provider Legal Information | LLM Gateway",
		description:
			"Review contracting entities, legal, privacy, acceptable use, data retention, location, and compliance information for every publicly listed AI provider available through LLM Gateway.",
		url: "https://llmgateway.io/legal/providers",
		type: "website",
	},
};

const DISCLOSURE_UPDATED_AT = "August 29, 2026";

function ExternalPolicyLink({
	href,
	children,
}: {
	href: string;
	children: ReactNode;
}) {
	return (
		<a
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			className="inline-flex items-center gap-1.5 text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
		>
			{children}
			<ExternalLink aria-hidden="true" className="size-3" />
		</a>
	);
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div>
			<span className="block text-xs font-medium text-muted-foreground">
				{label}
			</span>
			<span className="mt-1 block leading-5 text-foreground">{children}</span>
		</div>
	);
}

function BooleanFact({
	label,
	value,
	trueLabel = "Yes",
	falseLabel = "No",
	positiveWhen = true,
}: {
	label: string;
	value: boolean | null | undefined;
	trueLabel?: string;
	falseLabel?: string;
	positiveWhen?: boolean;
}) {
	const isPublished = value !== null && value !== undefined;
	const isPositive = isPublished && value === positiveWhen;
	const Icon = !isPublished ? Minus : isPositive ? Check : X;
	const text =
		value === true ? trueLabel : value === false ? falseLabel : "Not published";

	return (
		<div className="flex items-start gap-2">
			<span
				className={
					isPositive
						? "mt-0.5 text-emerald-600 dark:text-emerald-400"
						: isPublished
							? "mt-0.5 text-rose-600 dark:text-rose-400"
							: "mt-0.5 text-muted-foreground"
				}
			>
				<Icon aria-hidden="true" className="size-3.5" />
			</span>
			<div>
				<span className="block text-xs font-medium text-muted-foreground">
					{label}
				</span>
				<span className="mt-0.5 block leading-5 text-foreground">{text}</span>
			</div>
		</div>
	);
}

function getHeadquarters(provider: ProviderDefinition): string {
	if (!provider.headquarters) {
		return "Not published";
	}

	const countryName =
		PROVIDER_COUNTRY_NAMES[provider.headquarters] ?? provider.headquarters;
	return `${countryCodeToFlag(provider.headquarters)} ${countryName}`;
}

function getProcessingRegions(provider: ProviderDefinition): string {
	const regions = provider.regionConfig?.regions.map((region) => region.label);
	return regions?.length
		? regions.join(", ")
		: "Not specified in the catalogue";
}

function ProviderIdentity({ provider }: { provider: ProviderDefinition }) {
	const Logo = providerLogoUrls[provider.id as ProviderId];

	return (
		<div className="flex min-w-44 items-start gap-3">
			<div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted p-1.5">
				{Logo ? <Logo className="max-h-full max-w-full" /> : null}
			</div>
			<div>
				<Link
					href={`/providers/${provider.id}`}
					className="font-semibold text-foreground underline decoration-transparent underline-offset-4 hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					{provider.name}
				</Link>
				<p className="mt-1 text-xs text-muted-foreground">
					{activeModelCounts[provider.id] ?? 0} available models
				</p>
				<div className="mt-3 text-xs leading-5">
					<span className="block font-medium text-muted-foreground">
						Contracting entity
					</span>
					<span className="block text-foreground">
						{provider.legalEntity ?? "Not published"}
					</span>
				</div>
				<p className="mt-3 text-xs text-muted-foreground">
					Updated {DISCLOSURE_UPDATED_AT}
				</p>
			</div>
		</div>
	);
}

function ProviderLinks({ provider }: { provider: ProviderDefinition }) {
	const primaryLinks = [
		{ label: "Website", href: provider.website },
		{ label: "Terms", href: provider.termsUrl },
		{ label: "Privacy", href: provider.privacyPolicyUrl },
		{ label: "Usage policy", href: provider.usagePolicyUrl },
		{ label: "Status", href: provider.statusPageUrl },
	].filter((item): item is { label: string; href: string } =>
		Boolean(item.href),
	);

	return (
		<div className="min-w-40 space-y-2">
			{primaryLinks.map((item) => (
				<div key={item.label}>
					<ExternalPolicyLink href={item.href}>{item.label}</ExternalPolicyLink>
				</div>
			))}
			{provider.additionalLinks?.map((item) => (
				<div key={`${item.desc}-${item.link}`}>
					<ExternalPolicyLink href={item.link}>{item.desc}</ExternalPolicyLink>
				</div>
			))}
			{primaryLinks.length === 0 && !provider.additionalLinks?.length ? (
				<span className="text-muted-foreground">Not published</span>
			) : null}
		</div>
	);
}

function DataHandling({
	policy,
}: {
	policy: ProviderDataPolicy | null | undefined;
}) {
	return (
		<div className="min-w-40 space-y-3">
			<BooleanFact
				label="API data used for training"
				value={policy?.apiTraining}
				positiveWhen={false}
			/>
			<BooleanFact
				label="Prompt logging"
				value={policy?.promptLogging}
				positiveWhen={false}
			/>
			<Fact label="Retention period">
				{policy?.retentionPeriod ?? "Not published"}
			</Fact>
		</div>
	);
}

function Compliance({
	policy,
}: {
	policy: ProviderDataPolicy | null | undefined;
}) {
	return (
		<div className="min-w-40 space-y-3">
			<Fact label="SOC 2">{policy?.soc2 ? `Type ${policy.soc2}` : "No"}</Fact>
			<BooleanFact label="ISO 27001" value={policy?.iso27001 ?? false} />
			<BooleanFact label="GDPR" value={policy?.gdpr} />
		</div>
	);
}

export default function ProviderLegalInformationPage() {
	const providers = listedProviders
		.filter((provider) => Boolean(provider.website))
		.sort((a, b) => a.name.localeCompare(b.name));

	return (
		<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
			<HeroRSC navbarOnly />
			<main className="container mx-auto px-4 pb-24 pt-44 md:pt-52">
				<div className="mx-auto max-w-[1600px]">
					<header className="max-w-4xl">
						<Link
							href="/legal"
							className="text-sm font-medium text-muted-foreground underline decoration-transparent underline-offset-4 hover:text-foreground hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						>
							Legal information
						</Link>
						<h1 className="mt-5 font-display text-4xl font-semibold tracking-tight md:text-5xl">
							AI provider information
						</h1>
						<p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">
							Contracting entities, legal links, location details, data handling
							practices, and compliance information for every publicly listed
							provider currently available through LLM Gateway.
						</p>
					</header>

					<div className="mt-10 flex max-w-5xl gap-3 rounded-xl border bg-muted/40 p-4 text-sm leading-6 text-muted-foreground">
						<AlertCircle
							aria-hidden="true"
							className="mt-1 size-4 shrink-0 text-foreground"
						/>
						<p>
							The contracting entity is the counterparty named in the provider
							terms applicable to our account. Where providers assign affiliates
							by customer location, the listed entity reflects LLM
							Gateway&apos;s billing location; an order form may specify another
							entity. Headquarters identifies the provider&apos;s reported home
							country, not where a specific request is processed. Review the
							linked documents before routing sensitive data.
						</p>
					</div>

					<div className="mt-10 overflow-x-auto rounded-xl border">
						<table className="w-full min-w-[1220px] border-collapse text-left text-sm">
							<caption className="sr-only">
								Legal and compliance information for {providers.length} AI
								providers
							</caption>
							<thead className="bg-muted/70">
								<tr className="border-b">
									<th scope="col" className="px-4 py-4 font-semibold">
										Provider
									</th>
									<th scope="col" className="px-4 py-4 font-semibold">
										Legal &amp; policy links
									</th>
									<th scope="col" className="px-4 py-4 font-semibold">
										Location
									</th>
									<th scope="col" className="px-4 py-4 font-semibold">
										Data handling
									</th>
									<th scope="col" className="px-4 py-4 font-semibold">
										Compliance
									</th>
									<th scope="col" className="px-4 py-4 font-semibold">
										Request handling
									</th>
								</tr>
							</thead>
							<tbody>
								{providers.map((provider) => (
									<tr
										key={provider.id}
										className="border-b align-top last:border-b-0 hover:bg-muted/20"
									>
										<th scope="row" className="px-4 py-5 font-normal">
											<ProviderIdentity provider={provider} />
										</th>
										<td className="px-4 py-5">
											<ProviderLinks provider={provider} />
										</td>
										<td className="px-4 py-5">
											<dl className="min-w-56 space-y-4">
												<Fact label="Headquarters">
													{getHeadquarters(provider)}
												</Fact>
												<Fact label="Available processing regions">
													{getProcessingRegions(provider)}
												</Fact>
											</dl>
										</td>
										<td className="px-4 py-5">
											<DataHandling policy={provider.dataPolicy} />
										</td>
										<td className="px-4 py-5">
											<Compliance policy={provider.dataPolicy} />
										</td>
										<td className="px-4 py-5">
											<div className="min-w-40 space-y-3">
												<BooleanFact
													label="Safety identifier forwarded"
													value={provider.forwardsSafetyIdentifier}
													positiveWhen={false}
												/>
												<BooleanFact
													label="Request cancellation"
													value={provider.cancellation}
													trueLabel="Supported"
													falseLabel="Not supported"
												/>
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					<p className="mt-4 text-sm leading-6 text-muted-foreground">
						Information reflects the LLM Gateway provider catalogue as of{" "}
						{DISCLOSURE_UPDATED_AT}. Provider policies may change; the linked
						provider documents control.
					</p>
				</div>
			</main>
			<Footer />
		</div>
	);
}
