import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Brand Assets",
	description:
		"Download official LLM Gateway logos and brand assets. Get our logo in PNG or SVG format, with or without the name, in black and white variants.",
	alternates: { canonical: "/brand" },
	openGraph: {
		// og/twitter titles don't get the root title template, so the brand
		// must be spelled out here.
		title: "Brand Assets | LLM Gateway",
		description:
			"Download official LLM Gateway logos and brand assets in PNG or SVG, light and dark variants.",
		url: "https://llmgateway.io/brand",
		type: "website",
	},
};

export default function BrandLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<div>
			<HeroRSC navbarOnly />
			{children}
			<Footer />
		</div>
	);
}
