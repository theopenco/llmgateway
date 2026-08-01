import { AdminDashboardEnterprise } from "@/components/enterprise/admin-dashboard";
import { EnterpriseCapabilities } from "@/components/enterprise/capabilities";
import { ContactFormEnterprise } from "@/components/enterprise/contact";
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
import { UptimeVisualization } from "@/components/enterprise/uptime";
import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { Testimonials } from "@/components/landing/testimonials";
import { fetchServerData } from "@/lib/server-api";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Enterprise LLM Gateway – SSO, Audit Logs & Guardrails",
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
			<SecurityEnterprise />
			<SupportEnterprise />
			<EnterpriseCapabilities />
			<UptimeVisualization />
			<FeaturesEnterprise />
			<ProductShowcase />
			<AdminDashboardEnterprise />
			<Testimonials />
			<PricingEnterprise />
			<InfrastructureAsCodeEnterprise />
			<OpenSourceEnterprise />
			<ProcurementEnterprise />
			<ContactFormEnterprise />
			<Footer />
		</div>
	);
}
