import { GitHubStars } from "./github-stars";
import { Hero } from "./hero";

export const HeroRSC = async ({ navbarOnly }: { navbarOnly?: boolean }) => {
	return (
		<Hero navbarOnly={navbarOnly}>
			<GitHubStars />
		</Hero>
	);
};
