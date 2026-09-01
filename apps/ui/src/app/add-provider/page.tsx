import { AddProviderForm } from "@/components/add-provider/add-provider-form";
import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { getConfig } from "@/lib/config-server";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Add a Provider – LLM Gateway",
	description:
		"List your AI provider on LLM Gateway: self-serve via the Airside carrier console, or share your details and our team will get in touch.",
	openGraph: {
		title: "Add a Provider – LLM Gateway",
		description:
			"List your AI provider on LLM Gateway: self-serve via the Airside carrier console, or share your details and our team will get in touch.",
		type: "website",
	},
};

export default async function AddProviderPage({
	searchParams,
}: {
	searchParams: Promise<{ payment?: string }>;
}) {
	const { payment } = await searchParams;
	const initialPayment =
		payment === "success" || payment === "canceled" ? payment : null;
	const { airsideUrl } = getConfig();

	return (
		<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
			<main>
				<HeroRSC navbarOnly />
				<AddProviderForm
					initialPayment={initialPayment}
					airsideUrl={airsideUrl}
				/>
			</main>
			<Footer />
		</div>
	);
}
