import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";

export default function BrandLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<div>
			<HeroRSC />
			{children}
			<Footer />
		</div>
	);
}
