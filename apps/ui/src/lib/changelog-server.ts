import { notFound } from "next/navigation";

import {
	changelogPageSize,
	changelogPath,
	changelogProducts,
} from "@/lib/changelog";

import { allChangelogs } from "content-collections";

import type { ChangelogTag } from "@/lib/changelog";
import type { Metadata } from "next";

export type ChangelogSearchParams = Promise<{ page?: string | string[] }>;

export function getChangelogListing(
	rawPage: string | string[] | undefined,
	tag?: ChangelogTag,
) {
	const page = rawPage === undefined ? 1 : Number(rawPage);
	if (
		Array.isArray(rawPage) ||
		(rawPage !== undefined && !/^[1-9]\d*$/.test(rawPage)) ||
		!Number.isSafeInteger(page)
	) {
		notFound();
	}
	const entries = allChangelogs
		.filter((entry) => !entry.draft && (!tag || entry.tags.includes(tag)))
		.sort(
			(a, b) => b.date.localeCompare(a.date) || b.slug.localeCompare(a.slug),
		)
		.map(({ id, slug, date, title, summary, tags, image }) => ({
			id,
			slug,
			date,
			title,
			summary,
			tags,
			image,
		}));
	if (page > Math.max(1, Math.ceil(entries.length / changelogPageSize))) {
		notFound();
	}
	return { entries, page, tag };
}

export function changelogMetadata(page: number, tag?: ChangelogTag): Metadata {
	const title = `${tag ? `${changelogProducts[tag].name} ` : ""}Changelog${page > 1 ? ` — Page ${page}` : " — Product Updates"}`;
	const description = tag
		? changelogProducts[tag].description
		: "Explore the latest features, improvements, and fixes across LLM Gateway, DevPass, Lounge, and Airside. Filter by product and browse previous releases.";
	const canonical = changelogPath(tag, page);
	return {
		title,
		description,
		alternates: { canonical },
		openGraph: { title, description, type: "website", url: canonical },
		twitter: { card: "summary_large_image", title, description },
	};
}
