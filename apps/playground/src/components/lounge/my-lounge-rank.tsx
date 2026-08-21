"use client";

import { Flame, Sparkles } from "lucide-react";
import Link from "next/link";

import { useLoungePoints } from "@/hooks/useLoungePoints";
import { useUser } from "@/hooks/useUser";

// Signed-in banner above the public leaderboard: your points, level, and
// global rank, plus the opt-in nudge when the profile is still private.
export function MyLoungeRank() {
	const { user } = useUser();
	const { data } = useLoungePoints();

	if (!user || !data) {
		return null;
	}

	const { stats } = data;
	const onLeaderboard = user.profilePublic && user.username;

	return (
		<div className="mb-6 flex flex-col gap-3 rounded-xl border border-lounge-gold/25 bg-lounge-gold/[0.06] px-4 py-3.5 sm:flex-row sm:items-center sm:px-5">
			<div className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-sm">
				<span className="inline-flex items-center gap-1.5 font-semibold">
					<Sparkles className="h-4 w-4 text-lounge-gold" />
					{stats.totalPoints.toLocaleString()} points
				</span>
				<span className="text-muted-foreground">
					Lv {stats.level} · {stats.levelTitle}
				</span>
				{stats.rank ? (
					<span className="text-muted-foreground">
						Rank #{stats.rank.toLocaleString()}
					</span>
				) : null}
				{stats.currentStreak > 1 ? (
					<span className="inline-flex items-center gap-1 text-muted-foreground">
						<Flame className="h-3.5 w-3.5 text-orange-500" />
						{stats.currentStreak}-day streak
					</span>
				) : null}
			</div>
			<Link
				href="/profile"
				className="inline-flex items-center justify-center rounded-md border border-lounge-gold/40 px-3 py-1.5 text-xs font-medium text-lounge-gold transition-colors hover:bg-lounge-gold/10"
			>
				{onLeaderboard ? "View my profile" : "Join the leaderboard"}
			</Link>
		</div>
	);
}
