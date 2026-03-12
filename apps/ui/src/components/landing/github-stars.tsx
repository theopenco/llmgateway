import { Github, Star } from "lucide-react";

import { getConfig } from "@/lib/config-server";

async function fetchGitHubStars(repo: string): Promise<number | null> {
	try {
		const res = await fetch(`https://api.github.com/repos/${repo}`, {
			next: { revalidate: 600 },
			headers: {
				Accept: "application/vnd.github.v3+json",
				"User-Agent": "LLM Gateway",
			},
		});

		if (!res.ok) {
			console.warn(
				`Failed to fetch GitHub stars for ${repo}: ${res.status} ${res.statusText}`,
			);
			return null;
		}

		const data = await res.json();
		return data.stargazers_count;
	} catch (error) {
		console.warn(`Error fetching GitHub stars for ${repo}:`, error);
		return null;
	}
}

const REPO = "theopenco/llmgateway";

function formatNumber(num: number | null): string {
	if (num === null) {
		return "★";
	}
	if (num >= 1_000_000) {
		return (num / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
	}
	if (num >= 1_000) {
		return (num / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
	}
	return num.toLocaleString();
}

export async function GitHubStars() {
	const config = getConfig();
	const stars = await fetchGitHubStars(REPO);

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
