export const GITHUB_REPO = "theopenco/llmgateway";

export interface Contributor {
	login: string;
	avatar_url: string;
	contributions: number;
	html_url: string;
}

const GITHUB_REQUEST_INIT = {
	next: { revalidate: 600 },
	headers: {
		Accept: "application/vnd.github.v3+json",
		"User-Agent": "LLM Gateway",
	},
};

export async function fetchGitHubStars(repo: string): Promise<number | null> {
	try {
		const res = await fetch(
			`https://api.github.com/repos/${repo}`,
			GITHUB_REQUEST_INIT,
		);

		if (!res.ok) {
			console.warn(
				`Failed to fetch GitHub stars for ${repo}: ${res.status} ${res.statusText}`,
			);
			return null;
		}

		const data: { stargazers_count: number } = await res.json();
		return data.stargazers_count;
	} catch (error) {
		console.warn(`Error fetching GitHub stars for ${repo}:`, error);
		return null;
	}
}

export async function fetchGitHubContributors(
	repo: string,
): Promise<Contributor[] | null> {
	try {
		const res = await fetch(
			`https://api.github.com/repos/${repo}/contributors?per_page=100`,
			GITHUB_REQUEST_INIT,
		);

		if (!res.ok) {
			console.warn(
				`Failed to fetch GitHub contributors for ${repo}: ${res.status} ${res.statusText}`,
			);
			return null;
		}

		const data: Contributor[] = await res.json();
		return data;
	} catch (error) {
		console.warn(`Error fetching GitHub contributors for ${repo}:`, error);
		return null;
	}
}
