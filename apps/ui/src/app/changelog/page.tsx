import { allChangelogs, type Changelog } from "content-collections";

import { ChangelogComponent } from "@/components/changelog";
import { HeroRSC } from "@/components/landing/hero-rsc";

export default async function ChangelogPage() {
	const sortedEntries = allChangelogs
		.sort(
			(a: Changelog, b: Changelog) =>
				new Date(b.date).getTime() - new Date(a.date).getTime(),
		)
		.filter((entry: Changelog) => !entry?.draft)
		.map(({ ...entry }: Changelog) => entry);

	return (
		<div>
			<HeroRSC navbarOnly />
			<ChangelogComponent entries={sortedEntries} />
		</div>
	);
}

export async function generateMetadata() {
	return {
		title: "Changelog - LLM Gateway",
		description:
			"Stay up to date with the latest features, improvements, and fixes in LLM Gateway.",
		openGraph: {
			title: "Changelog - LLM Gateway",
			description:
				"Stay up to date with the latest features, improvements, and fixes in LLM Gateway.",
			type: "website",
		},
		twitter: {
			card: "summary_large_image",
			title: "Changelog - LLM Gateway",
			description:
				"Stay up to date with the latest features, improvements, and fixes in LLM Gateway.",
		},
	};
}
