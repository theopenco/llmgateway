import Link from "next/link";

import {
	AGENTS,
	formatTokens,
	type AgentDefinition,
} from "@/app/dashboard/components/coding-agents-shared";

import type { LeaderboardEntry } from "@/lib/leaderboard";

const AGENT_BY_SOURCE = new Map<string, AgentDefinition>();
for (const agent of AGENTS) {
	for (const source of agent.sources) {
		AGENT_BY_SOURCE.set(source.toLowerCase(), agent);
	}
}

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

function LeaderboardRow({ entry }: { entry: LeaderboardEntry }) {
	const displayName = entry.name?.trim() || entry.username;
	const agent = entry.topAgent
		? AGENT_BY_SOURCE.get(entry.topAgent.toLowerCase())
		: undefined;
	const AgentIcon = agent?.icon;
	const isTop = entry.rank <= 3;

	return (
		<Link
			href={`/profiles/${entry.username}`}
			className={`flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-muted/40 sm:px-5 ${
				isTop ? "bg-emerald-500/[0.04]" : ""
			}`}
		>
			{/* Rank */}
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

			{/* Avatar */}
			<div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-xl ring-1 ring-border">
				{entry.image ? (
					<img
						src={entry.image}
						alt={displayName}
						className="h-full w-full object-cover"
					/>
				) : (
					<div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
						{initials(entry.name, entry.username)}
					</div>
				)}
			</div>

			{/* Identity */}
			<div className="min-w-0 flex-1">
				<p className="truncate text-sm font-semibold tracking-tight">
					{displayName}
				</p>
				<p className="truncate text-xs text-muted-foreground">
					@{entry.username}
				</p>
			</div>

			{/* Top agent */}
			{agent && AgentIcon && (
				<div className="hidden items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs text-muted-foreground md:inline-flex">
					<AgentIcon className="h-3.5 w-3.5" />
					{agent.label}
				</div>
			)}

			{/* Tokens */}
			<div className="w-20 flex-shrink-0 text-right sm:w-28">
				<p className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400 sm:text-base">
					{formatTokens(entry.totalTokens)}
				</p>
				<p className="hidden text-[11px] text-muted-foreground sm:block">
					{entry.totalRequests.toLocaleString()} requests
				</p>
			</div>
		</Link>
	);
}

export function LeaderboardList({ entries }: { entries: LeaderboardEntry[] }) {
	if (entries.length === 0) {
		return (
			<div className="rounded-2xl border bg-card p-10 text-center">
				<p className="text-sm text-muted-foreground">
					The board is warming up. Make your profile public to claim a spot.
				</p>
			</div>
		);
	}

	return (
		<div className="overflow-hidden rounded-2xl border bg-card">
			<div className="flex items-center gap-4 border-b bg-muted/30 px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground sm:px-5">
				<span className="w-8 text-center">#</span>
				<span className="flex-1">Developer</span>
				<span className="w-20 text-right sm:w-28">Tokens routed</span>
			</div>
			<div className="divide-y divide-border/60">
				{entries.map((entry) => (
					<LeaderboardRow key={entry.username} entry={entry} />
				))}
			</div>
		</div>
	);
}
