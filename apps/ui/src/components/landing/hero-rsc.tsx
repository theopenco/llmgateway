import { fetchModels, fetchProviders } from "@/lib/fetch-models";

import { GitHubStars } from "./github-stars";
import { Hero } from "./hero";
import { allMigrations } from "content-collections";

export const HeroRSC = async ({
	navbarOnly,
	sticky = true,
}: {
	navbarOnly?: boolean;
	sticky?: boolean;
}) => {
	if (navbarOnly) {
		// Skip fetching models/providers/migrations for navbar-only mode
		return (
			<Hero navbarOnly sticky={sticky}>
				<GitHubStars />
			</Hero>
		);
	}

	const [models, providers] = await Promise.all([
		fetchModels(),
		fetchProviders(),
	]);
	const migrations = allMigrations.map((m) => ({
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
