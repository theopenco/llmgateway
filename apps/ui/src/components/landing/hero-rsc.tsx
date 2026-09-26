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
