"use client";

import { Flame, Sparkles } from "lucide-react";
import Link from "next/link";

import { useUser } from "@/hooks/useUser";
import { useApi } from "@/lib/fetch-client";

// Compact points pill for sidebar footers; links to the member profile.
export function SidebarLoungePoints() {
	const { user } = useUser();
	const api = useApi();

	const { data } = api.useQuery(
		"get",
		"/lounge/points/me",
		{},
		{
			enabled: !!user,
			retry: 0,
			staleTime: 60 * 1000,
			refetchOnWindowFocus: false,
		},
	);

	if (!user || !data) {
		return null;
	}

	const { stats } = data;

	return (
		<Link
			href="/profile"
			className="mx-2 mb-1 flex items-center gap-2 rounded-lg border border-lounge-gold/25 bg-lounge-gold/[0.06] px-3 py-2 text-xs transition-colors hover:bg-lounge-gold/10 group-data-[collapsible=icon]:hidden"
		>
			<Sparkles className="h-3.5 w-3.5 shrink-0 text-lounge-gold" />
			<span className="font-semibold tabular-nums">
				{stats.totalPoints.toLocaleString()}
			</span>
			<span className="text-muted-foreground">pts · Lv {stats.level}</span>
			{stats.currentStreak > 1 ? (
				<span className="ml-auto inline-flex items-center gap-0.5 text-muted-foreground">
					<Flame className="h-3.5 w-3.5 text-orange-500" />
					{stats.currentStreak}
				</span>
			) : null}
		</Link>
	);
}
