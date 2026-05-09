import { AdminDashboardEnterprise } from "@/components/enterprise/admin-dashboard";
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
	title: "Enterprise LLM Gateway",
	description:
		"Dedicated infrastructure, custom SLAs, SSO, and volume discounts for teams that need production-grade LLM routing at scale.",
	openGraph: {
		title: "Enterprise LLM Gateway",
		description:
			"Dedicated infrastructure, custom SLAs, SSO, and volume discounts for teams that need production-grade LLM routing at scale.",
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
