import { ChangelogPageContent } from "@/components/changelog-page";
import { changelogMetadata, getChangelogListing } from "@/lib/changelog-server";

import type { ChangelogSearchParams } from "@/lib/changelog-server";

interface Props {
	searchParams: ChangelogSearchParams;
}

export default async function ChangelogPage({ searchParams }: Props) {
	const listing = getChangelogListing((await searchParams).page);
	return <ChangelogPageContent {...listing} />;
}

export async function generateMetadata({ searchParams }: Props) {
	const { page } = getChangelogListing((await searchParams).page);
	return changelogMetadata(page);
}
