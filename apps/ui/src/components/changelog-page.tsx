import { Changelog } from "@/components/changelog";
import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { changelogPath } from "@/lib/changelog";

import type { getChangelogListing } from "@/lib/changelog-server";

export function ChangelogPageContent(
	props: ReturnType<typeof getChangelogListing>,
) {
	return (
		<>
			<HeroRSC navbarOnly />
			<Changelog key={changelogPath(props.tag, props.page)} {...props} />
			<Footer />
		</>
	);
}
