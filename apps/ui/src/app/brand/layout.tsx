import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Brand Assets | LLM Gateway",
	description:
		"Download official LLM Gateway logos and brand assets. Get our logo in PNG or SVG format, with or without the name, in black and white variants.",
	openGraph: {
		title: "Brand Assets | LLM Gateway",
		description:
			"Download official LLM Gateway logos and brand assets. Get our logo in PNG or SVG format, with or without the name, in black and white variants.",
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
