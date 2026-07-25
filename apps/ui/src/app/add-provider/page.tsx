import { AddProviderForm } from "@/components/add-provider/add-provider-form";
import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Add a Provider – LLM Gateway",
	description:
		"Request to list your AI provider on LLM Gateway. Share your provider details, compliance, and data policies and our team will get in touch.",
	openGraph: {
		title: "Add a Provider – LLM Gateway",
		description:
			"Request to list your AI provider on LLM Gateway. Share your provider details, compliance, and data policies and our team will get in touch.",
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

	return (
		<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
			<main>
				<HeroRSC navbarOnly />
				<AddProviderForm initialPayment={initialPayment} />
			</main>
			<Footer />
		</div>
	);
}
