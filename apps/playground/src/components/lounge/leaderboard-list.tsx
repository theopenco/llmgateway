import { Trophy } from "lucide-react";

import type { LoungeLeaderboardEntry } from "@/lib/lounge-leaderboard";

function initials(name: string | null, username: string): string {
	const source = name?.trim() || username;
	const parts = source.split(/\s+/).filter(Boolean);
	if (parts.length >= 2) {
		return (parts[0][0] + parts[1][0]).toUpperCase();
	}
	return source.slice(0, 2).toUpperCase();
}

function rankAccent(rank: number): string {
	switch (rank) {
		case 1:
			return "from-amber-300 to-amber-500 text-amber-950";
		case 2:
			return "from-slate-200 to-slate-400 text-slate-900";
		case 3:
			return "from-orange-300 to-orange-600 text-orange-950";
		default:
			return "";
	}
}

function LeaderboardRow({ entry }: { entry: LoungeLeaderboardEntry }) {
	const displayName = entry.name?.trim() || entry.username;
	const isTop = entry.rank <= 3;

	return (
		<li
			className={`flex items-center gap-3 px-4 py-3.5 sm:gap-4 sm:px-5 ${
				isTop ? "bg-lounge-gold/[0.05]" : ""
			}`}
		>
			<div className="flex w-8 flex-shrink-0 justify-center">
				{isTop ? (
					<span
						className={`flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br text-sm font-bold tabular-nums shadow-sm ${rankAccent(
							entry.rank,
						)}`}
					>
						{entry.rank}
					</span>
				) : (
					<span className="text-sm font-medium tabular-nums text-muted-foreground">
						{entry.rank}
					</span>
				)}
			</div>

			<div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-full ring-1 ring-border">
				{entry.image ? (
					<img
						src={entry.image}
						alt={displayName}
						className="h-full w-full object-cover"
					/>
				) : (
					<div className="flex h-full w-full items-center justify-center bg-muted text-xs font-semibold text-muted-foreground">
						{initials(entry.name, entry.username)}
					</div>
				)}
			</div>

			<div className="min-w-0 flex-1">
				<div className="truncate text-sm font-medium">{displayName}</div>
				<div className="truncate text-xs text-muted-foreground">
					@{entry.username}
				</div>
			</div>

			<span className="hidden flex-shrink-0 rounded-full border border-lounge-gold/30 bg-lounge-gold/10 px-2.5 py-0.5 text-[11px] font-medium text-lounge-gold sm:inline-flex">
				Lv {entry.level} · {entry.levelTitle}
			</span>

			<div className="flex-shrink-0 text-right">
				<div className="text-sm font-semibold tabular-nums">
					{entry.points.toLocaleString()}
				</div>
				<div className="text-[11px] text-muted-foreground">points</div>
			</div>
		</li>
	);
}

export function LoungeLeaderboardList({
	entries,
}: {
	entries: LoungeLeaderboardEntry[];
}) {
	if (entries.length === 0) {
		return (
			<div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
				<Trophy className="h-8 w-8 text-muted-foreground/50" />
				<p className="text-sm text-muted-foreground">
					Nobody is on the leaderboard yet. Earn points in the Lounge and be the
					first to claim a spot.
				</p>
			</div>
		);
	}

	return (
		<ul className="divide-y divide-border overflow-hidden rounded-xl border">
			{entries.map((entry) => (
				<LeaderboardRow key={entry.username} entry={entry} />
			))}
		</ul>
	);
}
