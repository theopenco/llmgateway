import { notFound } from "next/navigation";

import { ChangelogPageContent } from "@/components/changelog-page";
import { isChangelogTag } from "@/lib/changelog";
import { changelogMetadata, getChangelogListing } from "@/lib/changelog-server";

import type { ChangelogSearchParams } from "@/lib/changelog-server";

interface Props {
	params: Promise<{ tag: string }>;
	searchParams: ChangelogSearchParams;
}

async function getListing({ params, searchParams }: Props) {
	const [{ tag }, { page }] = await Promise.all([params, searchParams]);
	if (!isChangelogTag(tag)) {
		notFound();
	}
	return getChangelogListing(page, tag);
}

export default async function ProductChangelogPage(props: Props) {
	return <ChangelogPageContent {...await getListing(props)} />;
}

export async function generateMetadata(props: Props) {
	const { page, tag } = await getListing(props);
	return changelogMetadata(page, tag);
}
