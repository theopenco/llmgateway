import { Changelog } from "@/components/changelog";
import { HeroRSC } from "@/components/landing/hero-rsc";

import type { Changelog as ChangelogType } from "content-collections";

export default async function ChangelogPage() {
	const { allChangelogs } = await import("content-collections");

	const sortedEntries = allChangelogs
		.sort(
			(a: ChangelogType, b: ChangelogType) =>
				new Date(b.date).getTime() - new Date(a.date).getTime(),
		)
		.filter((entry: ChangelogType) => !entry?.draft)
		.map(({ ...entry }: ChangelogType) => entry);

	return (
		<div>
			<HeroRSC navbarOnly />
			<Changelog entries={sortedEntries} />
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
