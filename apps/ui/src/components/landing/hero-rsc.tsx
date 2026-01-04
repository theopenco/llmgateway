import { GitHubStars } from "./github-stars";
import { Hero } from "./hero";

export const HeroRSC = async ({
	navbarOnly,
	sticky = true,
}: {
	navbarOnly?: boolean;
	sticky?: boolean;
}) => {
	return (
		<Hero navbarOnly={navbarOnly} sticky={sticky}>
			<GitHubStars />
		</Hero>
	);
};
