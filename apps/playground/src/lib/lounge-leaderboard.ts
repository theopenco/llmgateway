import { getConfig } from "@/lib/config-server";

export interface LoungeLeaderboardEntry {
	rank: number;
	username: string;
	name: string | null;
	image: string | null;
	points: number;
	level: number;
	levelTitle: string;
}

export async function fetchLoungeLeaderboard(
	limit = 50,
): Promise<LoungeLeaderboardEntry[]> {
	const config = getConfig();

	try {
		const res = await fetch(
			`${config.apiBackendUrl}/public/lounge-leaderboard?limit=${limit}`,
			{ next: { revalidate: 300 }, signal: AbortSignal.timeout(10_000) },
		);
		if (!res.ok) {
			return [];
		}
		const data = (await res.json()) as { entries?: LoungeLeaderboardEntry[] };
		return data.entries ?? [];
	} catch {
		return [];
	}
}
