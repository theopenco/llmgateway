import { AdminDashboardEnterprise } from "@/components/enterprise/admin-dashboard";
import { EnterpriseCapabilities } from "@/components/enterprise/capabilities";
import { ContactFormEnterprise } from "@/components/enterprise/contact";
import { CostCalculator } from "@/components/enterprise/cost-calculator";
import { FeaturesEnterprise } from "@/components/enterprise/features";
import { HeroEnterprise } from "@/components/enterprise/hero";
import { OpenSourceEnterprise } from "@/components/enterprise/open-source";
import { PricingEnterprise } from "@/components/enterprise/pricing";
import { ProductShowcase } from "@/components/enterprise/product-showcase";
import { TrustBarEnterprise } from "@/components/enterprise/trust-bar";
import { UptimeVisualization } from "@/components/enterprise/uptime";
// import { SecurityEnterprise } from "@/components/enterprise/security";
import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { Testimonials } from "@/components/landing/testimonials";
import { fetchServerData } from "@/lib/server-api";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Enterprise LLM Gateway – SSO, Audit Logs, Guardrails & Routing",
	description:
		"Production-grade LLM infrastructure with SAML SSO, immutable audit logs, prompt-injection guardrails, per-project routing overrides, and white-label chat. Built for teams under SOC 2, HIPAA, or internal-AI scrutiny.",
	openGraph: {
		title: "Enterprise LLM Gateway",
		description:
			"SAML SSO, immutable audit logs, guardrails, per-project routing, and white-label chat — every capability a regulated team needs to put LLMs in production.",
		type: "website",
	},
	twitter: {
		card: "summary_large_image",
		title: "Enterprise LLM Gateway",
		description:
			"SAML SSO, audit logs, guardrails, per-project routing, white-label chat. Production-grade LLM infrastructure for regulated teams.",
	},
};

export const revalidate = 300;

interface PublicAppsResponse {
	totalTokens: number;
	totalRequests: number;
}

export default async function EnterprisePage() {
	const stats = await fetchServerData<PublicAppsResponse>(
		"GET",
		"/public/apps",
		{ params: { query: { limit: "1" } } },
	);

	return (
		<div>
			<HeroRSC navbarOnly />
			<HeroEnterprise
				totalTokens={stats?.totalTokens}
				totalRequests={stats?.totalRequests}
			/>
			<TrustBarEnterprise />
			<EnterpriseCapabilities />
			<UptimeVisualization />
			<FeaturesEnterprise />
			<CostCalculator />
			<ProductShowcase />
			<AdminDashboardEnterprise />
			{/* <SecurityEnterprise /> */}
			<Testimonials />
			<PricingEnterprise />
			<OpenSourceEnterprise />
			<ContactFormEnterprise />
			<Footer />
		</div>
	);
}
