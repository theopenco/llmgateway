import { fetchModels, fetchProviders } from "@/lib/fetch-models";

import { GitHubStars } from "./github-stars";
import { Hero } from "./hero";

export const HeroRSC = async ({
	navbarOnly,
	sticky = true,
}: {
	navbarOnly?: boolean;
	sticky?: boolean;
}) => {
	const [{ allMigrations }, models, providers] = await Promise.all([
		import("content-collections"),
		fetchModels(),
		fetchProviders(),
	]);
	const migrations = navbarOnly
		? []
		: allMigrations.map((m) => ({
				slug: m.slug,
				title: m.title,
				fromProvider: m.fromProvider,
			}));

	return (
		<Hero
			navbarOnly={navbarOnly}
			sticky={sticky}
			migrations={migrations}
			models={models}
			providers={providers}
		>
			<GitHubStars />
		</Hero>
	);
};
