"use client";
import { useQuery } from "@tanstack/react-query";
import { Star } from "lucide-react";

import { Button } from "@/lib/components/button";
import { useAppConfig } from "@/lib/config";

async function fetchGitHubStars(repo: string): Promise<number> {
	const res = await fetch(`https://api.github.com/repos/${repo}`);
	if (!res.ok) {
		throw new Error("Failed to fetch GitHub repo");
	}
	const data = await res.json();
	return data.stargazers_count;
}

function useGitHubStars(repo: string) {
	return useQuery({
		queryKey: ["github-stars", repo],
		queryFn: () => fetchGitHubStars(repo),
		refetchOnWindowFocus: false,
		staleTime: 1000 * 60 * 10, // 10 minutes
	});
}

const REPO = "theopenco/llmgateway";

function formatNumber(num: number | undefined): string {
	if (num === undefined) {
		return "";
	}
	if (num >= 1_000_000) {
		return (num / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
	}
	if (num >= 1_000) {
		return (num / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
	}
	return num.toLocaleString();
}

export function GitHubStars() {
	const config = useAppConfig();
	const { data: stars, isLoading, isError } = useGitHubStars(REPO);

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
					<span className="text-xs">
						{isLoading ? "..." : isError ? "?" : formatNumber(stars)}
					</span>
				</span>
			</a>
		</Button>
	);
}
