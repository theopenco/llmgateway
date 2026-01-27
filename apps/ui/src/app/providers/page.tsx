import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { ProvidersGrid } from "@/components/providers/providers-grid";

export default function ProvidersPage() {
	return (
		<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
			<main>
				<HeroRSC navbarOnly />
				<ProvidersGrid />
			</main>
			<Footer />
		</div>
	);
}
