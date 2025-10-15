import { BookOpen, Code2, Github, Star } from "lucide-react";
import Link from "next/link";

import { Button } from "@/lib/components/button";

const GITHUB_REPO = "theopenco/llmgateway";

interface Contributor {
	login: string;
	avatar_url: string;
	contributions: number;
	html_url: string;
}

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

async function fetchGitHubContributors(
	repo: string,
): Promise<Contributor[] | null> {
	try {
		const res = await fetch(
			`https://api.github.com/repos/${repo}/contributors?per_page=100`,
			{
				next: { revalidate: 600 }, // Revalidate every 10 minutes
				headers: {
					Accept: "application/vnd.github.v3+json",
					"User-Agent": "LLM Gateway",
				},
			},
		);

		if (!res.ok) {
			console.warn(
				`Failed to fetch GitHub contributors for ${repo}: ${res.status} ${res.statusText}`,
			);
			return null;
		}

		const data = await res.json();
		return data;
	} catch (error) {
		console.warn(`Error fetching GitHub contributors for ${repo}:`, error);
		return null;
	}
}

function formatNumber(num: number | null): string {
	if (num === null) {
		return "20K+";
	}
	if (num >= 1000) {
		const thousands = Math.floor(num / 1000);
		const hundreds = Math.floor((num % 1000) / 100);
		if (hundreds === 0) {
			return `${thousands}K`;
		}
		return `${thousands}.${hundreds}K`;
	}
	return num.toLocaleString();
}

export async function OpenSourceEnterprise() {
	const [stars, contributors] = await Promise.all([
		fetchGitHubStars(GITHUB_REPO),
		fetchGitHubContributors(GITHUB_REPO),
	]);

	const formattedStars = formatNumber(stars);
	const contributorCount = contributors?.length ?? 60;
	return (
		<section className="py-20 sm:py-28 bg-muted/30">
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				<div className="mx-auto max-w-7xl">
					<div className="grid gap-12 lg:grid-cols-2 lg:gap-16 items-center">
						{/* Left side - Content */}
						<div className="space-y-6">
							<div className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-sm">
								<Code2 className="h-4 w-4" />
								<span className="font-medium">Open source</span>
							</div>

							<div className="space-y-4">
								<h2 className="text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
									Building trust and driving collaboration
								</h2>
								<p className="text-lg text-muted-foreground leading-relaxed max-w-xl">
									We share our code so you can move faster, stay secure, and
									build together.
								</p>
							</div>

							<div className="flex flex-wrap gap-3">
								<Button asChild size="lg">
									<Link
										href="https://docs.llmgateway.io"
										target="_blank"
										rel="noopener noreferrer"
									>
										<BookOpen className="mr-2 h-4 w-4" />
										Read the docs
									</Link>
								</Button>
								<Button asChild variant="outline" size="lg">
									<Link
										href={`https://github.com/${GITHUB_REPO}`}
										target="_blank"
										rel="noopener noreferrer"
									>
										<Github className="mr-2 h-4 w-4" />
										View the code
									</Link>
								</Button>
							</div>
						</div>

						{/* Right side - Stats */}
						<div className="space-y-12">
							{/* Stars */}
							<div className="flex flex-col items-center lg:items-start space-y-4">
								<div className="flex gap-2">
									{[...Array(3)].map((_, i) => (
										<Star
											key={i}
											className="h-12 w-12 fill-yellow-400 text-yellow-400"
										/>
									))}
								</div>
								<div className="text-center lg:text-left">
									<div className="text-2xl font-bold">
										{formattedStars} Stars
									</div>
									<p className="text-sm text-muted-foreground">
										Trusted by the community
									</p>
								</div>
							</div>

							{/* Contributors */}
							<div className="flex flex-col items-center lg:items-start space-y-4">
								<div className="flex -space-x-3">
									{contributors && contributors.length > 0
										? contributors.slice(0, 8).map((contributor) => (
												<a
													key={contributor.login}
													href={contributor.html_url}
													target="_blank"
													rel="noopener noreferrer"
													className="group relative"
													title={`${contributor.login} - ${contributor.contributions} contributions`}
												>
													<img
														src={contributor.avatar_url}
														alt={contributor.login}
														className="h-12 w-12 rounded-full border-2 border-background transition-transform group-hover:scale-110 group-hover:z-10"
													/>
												</a>
											))
										: // Fallback placeholders if API fails
											[...Array(8)].map((_, i) => (
												<div
													key={i}
													className="h-12 w-12 rounded-full border-2 border-background bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-semibold"
												>
													{String.fromCharCode(65 + i)}
												</div>
											))}
								</div>
								<div className="text-center lg:text-left">
									<div className="text-2xl font-bold">
										{contributorCount}+ Contributors
									</div>
									<p className="text-sm text-muted-foreground">
										Building the future together
									</p>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}
