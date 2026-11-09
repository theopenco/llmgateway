import dynamic from "next/dynamic";
import { Suspense } from "react";

import { AdminDashboardEnterprise } from "@/components/enterprise/admin-dashboard";
import { EnterpriseCapabilities } from "@/components/enterprise/capabilities";
import { FeaturesEnterprise } from "@/components/enterprise/features";
import { HeroEnterprise } from "@/components/enterprise/hero";
import { InfrastructureAsCodeEnterprise } from "@/components/enterprise/iac";
import { OpenSourceEnterprise } from "@/components/enterprise/open-source";
import { PricingEnterprise } from "@/components/enterprise/pricing";
import { ProcurementEnterprise } from "@/components/enterprise/procurement";
import { ProductShowcase } from "@/components/enterprise/product-showcase";
import { SecurityEnterprise } from "@/components/enterprise/security";
import { SupportEnterprise } from "@/components/enterprise/support";
import { TrustBarEnterprise } from "@/components/enterprise/trust-bar";
import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import {
	Testimonials,
	TestimonialsFallback,
} from "@/components/landing/testimonials";
import { pageTitle } from "@/lib/page-title";
import { fetchServerData } from "@/lib/server-api";

import type { Metadata } from "next";

// Below-the-fold client sections, split out of the route's initial bundle the
// same way the home page loads Uptime.
const UptimeVisualization = dynamic(() =>
	import("@/components/enterprise/uptime").then(
		(mod) => mod.UptimeVisualization,
	),
);
const ContactFormEnterprise = dynamic(() =>
	import("@/components/enterprise/contact").then(
		(mod) => mod.ContactFormEnterprise,
	),
);

export const metadata: Metadata = {
	title: pageTitle("Enterprise LLM Gateway – SSO, Audit Logs & Guardrails"),
	description:
		"SOC 2 Type II LLM infrastructure with SAML SSO, audit logs, prompt-injection guardrails, per-project routing, and white-label chat for regulated teams.",
	alternates: { canonical: "/enterprise" },
	openGraph: {
		title: "Enterprise LLM Gateway",
		description:
			"SAML SSO, audit logs, guardrails, per-project routing, and white-label chat for regulated teams putting LLMs in production.",
		type: "website",
		url: "https://llmgateway.io/enterprise",
	},
	twitter: {
		card: "summary_large_image",
		title: "Enterprise LLM Gateway",
		description:
			"SAML SSO, audit logs, guardrails, per-project routing, and white-label chat for regulated teams.",
	},
};

export const revalidate = 300;

interface PublicAppsResponse {
	totalTokens: number;
	totalRequests: number;
}

// Awaiting the stats inside a child keeps the page component synchronous, so
// the sibling sections' GitHub and tweet fetches start in parallel with this
// one instead of queueing behind it.
async function HeroEnterpriseWithStats() {
	const stats = await fetchServerData<PublicAppsResponse>(
		"GET",
		"/public/apps",
		{ params: { query: { limit: "1" } } },
	);

	return (
		<HeroEnterprise
			totalTokens={stats?.totalTokens}
			totalRequests={stats?.totalRequests}
		/>
	);
}

export default function EnterprisePage() {
	return (
		<div>
			<HeroRSC />
			<Suspense fallback={<HeroEnterprise />}>
				<HeroEnterpriseWithStats />
			</Suspense>
			<TrustBarEnterprise />
			<SecurityEnterprise />
			<SupportEnterprise />
			<EnterpriseCapabilities />
			<UptimeVisualization />
			<FeaturesEnterprise />
			<ProductShowcase />
			<AdminDashboardEnterprise />
			<Suspense fallback={<TestimonialsFallback />}>
				<Testimonials />
			</Suspense>
			<PricingEnterprise />
			<InfrastructureAsCodeEnterprise />
			<OpenSourceEnterprise />
			<ProcurementEnterprise />
			<ContactFormEnterprise />
			<Footer />
		</div>
	);
}
