import { GitHubStars } from "./github-stars";
import { Hero } from "./hero";

export const HeroRSC = async ({
	navbarOnly,
	sticky = true,
}: {
	navbarOnly?: boolean;
	sticky?: boolean;
}) => {
	const { allMigrations } = await import("content-collections");
	const migrations = navbarOnly
		? []
		: allMigrations.map((m) => ({
				slug: m.slug,
				title: m.title,
				fromProvider: m.fromProvider,
			}));

	return (
		<Hero navbarOnly={navbarOnly} sticky={sticky} migrations={migrations}>
			<GitHubStars />
		</Hero>
	);
};
