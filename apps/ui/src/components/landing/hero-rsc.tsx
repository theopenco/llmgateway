import { Suspense } from "react";

import { GitHubStars } from "./github-stars";
import { Hero } from "./hero";

export const HeroRSC = ({ sticky = true }: { sticky?: boolean }) => (
	<Hero sticky={sticky}>
		<Suspense fallback={<span className="block h-8 w-16" aria-hidden />}>
			<GitHubStars />
		</Suspense>
	</Hero>
);
