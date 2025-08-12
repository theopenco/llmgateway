import { Star } from "lucide-react";

import { Button } from "@/lib/components/button";
import { getConfig } from "@/lib/config-server";

async function fetchGitHubStars(repo: string): Promise<number | null> {
	try {
		const res = await fetch(`https://api.github.com/repos/${repo}`, {
			next: { revalidate: 600 }, // Revalidate every 10 minutes
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
		<Button variant="secondary" className="w-full md:w-fit" asChild>
			<a
				href={config.githubUrl ?? ""}
				target="_blank"
				rel="noopener noreferrer"
				className="group"
			>
				<Star
					className="-ms-1 me-2 opacity-60 transition-colors duration-200 group-hover:fill-yellow-400 group-hover:opacity-100 group-hover:stroke-transparent"
					size={16}
					fill="none"
				/>
				<span className="flex items-baseline gap-2">
					Star
					<span className="text-xs">{formatNumber(stars)}</span>
				</span>
			</a>
		</Button>
	);
}
