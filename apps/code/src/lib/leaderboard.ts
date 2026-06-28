import { getConfig } from "@/lib/config-server";

import type { paths } from "@/lib/api/v1";

export type LeaderboardResponse =
	paths["/public/leaderboard"]["get"]["responses"][200]["content"]["application/json"];

export type LeaderboardEntry = LeaderboardResponse["entries"][number];

/**
 * Fetch the public DevPass leaderboard (profiles ranked by tokens routed).
 * Returns an empty list on failure. Used by the public /leaderboard page.
 */
export async function fetchLeaderboard(
	limit = 50,
): Promise<LeaderboardEntry[]> {
	const config = getConfig();
	try {
		const res = await fetch(
			`${config.apiBackendUrl}/public/leaderboard?limit=${limit}`,
			{ next: { revalidate: 300 } },
		);
		if (!res.ok) {
			return [];
		}
		const json = (await res.json()) as LeaderboardResponse;
		return json.entries;
	} catch {
		return [];
	}
}
