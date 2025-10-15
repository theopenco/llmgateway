import { ContactFormEnterprise } from "@/components/enterprise/contact";
import { FeaturesEnterprise } from "@/components/enterprise/features";
import { HeroEnterprise } from "@/components/enterprise/hero";
import { OpenSourceEnterprise } from "@/components/enterprise/open-source";
import { PricingEnterprise } from "@/components/enterprise/pricing";
import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { Testimonials } from "@/components/landing/testimonials";

export default function EnterprisePage() {
	return (
		<div>
			<HeroRSC navbarOnly />
			<HeroEnterprise />
			<Testimonials />
			<FeaturesEnterprise />
			<PricingEnterprise />
			<OpenSourceEnterprise />
			<ContactFormEnterprise />
			<Footer />
		</div>
	);
}
