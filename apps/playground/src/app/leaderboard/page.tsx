import { ArrowLeft, Trophy } from "lucide-react";
import Link from "next/link";

import { LoungeLeaderboardList } from "@/components/lounge/leaderboard-list";
import { MyLoungeRank } from "@/components/lounge/my-lounge-rank";
import { fetchLoungeLeaderboard } from "@/lib/lounge-leaderboard";

import type { Metadata } from "next";

export const revalidate = 300;

export const metadata: Metadata = {
	title: "Leaderboard",
	description:
		"The most active members of the Lounge, ranked by points earned chatting and creating across every frontier model.",
	alternates: {
		canonical: "/leaderboard",
	},
};

export default async function LoungeLeaderboardPage() {
	const entries = await fetchLoungeLeaderboard(100);

	return (
		<main className="mx-auto max-w-3xl px-4 py-16 sm:py-20">
			<Link
				href="/"
				className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
			>
				<ArrowLeft className="h-4 w-4" />
				Back to chat
			</Link>

			<header className="mb-10 text-center">
				<p className="mb-4 flex items-center justify-center gap-3 text-[11px] font-semibold uppercase tracking-[0.28em] text-lounge-gold">
					<span aria-hidden className="h-px w-8 bg-lounge-gold/50" />
					The Lounge · Leaderboard
					<span aria-hidden className="h-px w-8 bg-lounge-gold/50" />
				</p>
				<h1 className="font-display text-3xl font-semibold tracking-tight sm:text-5xl">
					The most active members
				</h1>
				<p className="mx-auto mt-4 max-w-xl text-muted-foreground">
					Points are earned for every chat, image, video, and audio creation.
					<span className="mx-1 inline-flex translate-y-0.5 items-center">
						<Trophy className="h-4 w-4 text-lounge-gold" />
					</span>
					Make your profile public to claim your spot.
				</p>
			</header>

			<MyLoungeRank />

			<LoungeLeaderboardList entries={entries} />
		</main>
	);
}
