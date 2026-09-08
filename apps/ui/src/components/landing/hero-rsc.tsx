import { Suspense } from "react";

import { GitHubStars } from "./github-stars";
import { Hero } from "./hero";
import { allMigrations } from "content-collections";

export const HeroRSC = ({
	navbarOnly,
	sticky = true,
}: {
	navbarOnly?: boolean;
	sticky?: boolean;
}) => {
	const githubStars = (
		<Suspense fallback={<span className="block h-8 w-16" aria-hidden />}>
			<GitHubStars />
		</Suspense>
	);

	if (navbarOnly) {
		return (
			<Hero navbarOnly sticky={sticky}>
				{githubStars}
			</Hero>
		);
	}

	// Models/providers are intentionally not fetched here: serializing the full
	// catalogue into the RSC payload added ~2MB to the landing page HTML. The
	// navbar's ModelSearch lazily fetches them client-side when opened.
	const hiddenMigrations = new Set(["vercel-ai-gateway", "portkey"]);
	const migrations = allMigrations
		.filter((m) => !hiddenMigrations.has(m.slug))
		.map((m) => ({
			slug: m.slug,
			title: m.title,
			fromProvider: m.fromProvider,
		}));

	return (
		<Hero navbarOnly={navbarOnly} sticky={sticky} migrations={migrations}>
			{githubStars}
		</Hero>
	);
};
