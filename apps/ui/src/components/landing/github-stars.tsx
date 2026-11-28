import { Github, Star } from "lucide-react";

import { getConfig } from "@/lib/config-server";
import { fetchGitHubStars, GITHUB_REPO } from "@/lib/github";

import { formatCompactNumber } from "@llmgateway/shared/number-format";

function formatNumber(num: number | null): string {
	return num === null ? "★" : formatCompactNumber(num);
}

export async function GitHubStars() {
	const config = getConfig();
	const stars = await fetchGitHubStars(GITHUB_REPO);

	return (
		<a
			href={config.githubUrl ?? ""}
			target="_blank"
			rel="noopener noreferrer"
			className="group relative flex items-center gap-0.5 rounded-full p-1.5 text-muted-foreground transition-colors hover:text-foreground"
			aria-label={`GitHub - ${formatNumber(stars)} stars`}
		>
			<div className="relative">
				<Github className="h-5 w-5" />
				<Star
					className="absolute -right-1 -top-1 h-2.5 w-2.5 fill-yellow-400 stroke-yellow-400 transition-transform group-hover:scale-110"
					strokeWidth={2}
				/>
			</div>
			<span className="ml-1 text-xs font-medium tabular-nums">
				{formatNumber(stars)}
			</span>
		</a>
	);
}
