import dynamic from "next/dynamic";

import { ControlPlane } from "@/components/home/control-plane";
import { HomeHero } from "@/components/home/home-hero";
import { HeroRSC } from "@/components/landing/hero-rsc";

import { allMigrations } from "content-collections";

const TrustBar = dynamic(() =>
	import("@/components/enterprise/trust-bar").then(
		(mod) => mod.TrustBarEnterprise,
	),
);
const ProductFamily = dynamic(() =>
	import("@/components/home/product-family").then((mod) => mod.ProductFamily),
);
const DeveloperLane = dynamic(() =>
	import("@/components/home/developer-lane").then((mod) => mod.DeveloperLane),
);
const Faq = dynamic(() =>
	import("@/components/landing/faq").then((mod) => mod.Faq),
);
const Closing = dynamic(() =>
	import("@/components/home/closing").then((mod) => mod.Closing),
);
const Footer = dynamic(() => import("@/components/landing/footer"));

const HIDDEN_MIGRATIONS = new Set(["vercel-ai-gateway", "portkey"]);

export default function Home() {
	const migrations = allMigrations
		.filter((m) => !HIDDEN_MIGRATIONS.has(m.slug))
		.map((m) => ({ slug: m.slug, fromProvider: m.fromProvider }));

	return (
		<>
			<HeroRSC pilotCta />
			<main>
				<HomeHero />
				<TrustBar />
				<ControlPlane />
				<ProductFamily />
				<DeveloperLane migrations={migrations} />
				<Faq />
				<Closing />
			</main>
			<Footer />
		</>
	);
}
