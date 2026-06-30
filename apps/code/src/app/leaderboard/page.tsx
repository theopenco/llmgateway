import { Trophy } from "lucide-react";
import Link from "next/link";

import { Footer } from "@/components/Footer";
import { GetDevPassButton } from "@/components/GetDevPassButton";
import { Header } from "@/components/Header";
import { LeaderboardList } from "@/components/leaderboard/LeaderboardList";
import { Button } from "@/components/ui/button";
import { fetchLeaderboard } from "@/lib/leaderboard";

import type { Metadata } from "next";

const BASE_URL = "https://devpass.llmgateway.io";

export const revalidate = 300;

export const metadata: Metadata = {
	title: "DevPass Leaderboard — Developers ranked by tokens routed",
	description:
		"See which developers route the most tokens through DevPass — one key, every model. Make your profile public to claim your spot.",
	alternates: { canonical: "/leaderboard" },
	openGraph: {
		title: "DevPass Leaderboard — Developers ranked by tokens routed",
		description:
			"The developers routing the most tokens through DevPass. One key, every model.",
		type: "website",
		url: `${BASE_URL}/leaderboard`,
	},
	twitter: {
		card: "summary_large_image",
		title: "DevPass Leaderboard",
		description:
			"The developers routing the most tokens through DevPass. One key, every model.",
	},
};

export default async function LeaderboardPage() {
	const entries = await fetchLeaderboard(100);

	return (
		<div className="min-h-screen bg-background">
			<Header />

			<main>
				{/* Hero */}
				<section className="relative overflow-hidden border-b">
					<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_55%_55%_at_50%_-5%,_var(--tw-gradient-stops))] from-emerald-500/10 via-transparent to-transparent" />
					<div className="container relative mx-auto max-w-3xl px-4 pt-16 pb-12 text-center sm:pt-20">
						<div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
							<Trophy className="h-3.5 w-3.5" />
							Live leaderboard
						</div>
						<h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl">
							The most prolific developers on DevPass
						</h1>
						<p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-pretty text-muted-foreground">
							Ranked by tokens routed across every model in the last year. One
							key, every model — these developers ship with all of them.
						</p>
						<div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
							<GetDevPassButton
								cta="get_started"
								location="leaderboard_hero"
								signupHref="/signup?plan=pro"
								showArrow
							/>
							<Button size="lg" variant="ghost" asChild>
								<Link href="/profile">Claim your spot</Link>
							</Button>
						</div>
					</div>
				</section>

				{/* Board */}
				<section className="px-4 py-12">
					<div className="container mx-auto max-w-3xl">
						<LeaderboardList entries={entries} />
						<p className="mt-4 text-center text-xs text-muted-foreground">
							Only developers with a public profile appear here. Totals cover
							the last 12 months and refresh periodically.
						</p>
					</div>
				</section>

				{/* CTA */}
				<section className="border-t bg-muted/20 px-4 py-16">
					<div className="container mx-auto max-w-2xl text-center">
						<h2 className="mb-3 text-2xl font-bold tracking-tight sm:text-3xl">
							Want your name on the board?
						</h2>
						<p className="mb-8 text-muted-foreground">
							Flip your profile public, then ship. Every request you route
							climbs the ranks — and your profile becomes a shareable record of
							what you build.
						</p>
						<div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
							<GetDevPassButton
								cta="get_started"
								location="leaderboard_bottom_cta"
								signupHref="/signup?plan=pro"
								showArrow
							/>
							<Button size="lg" variant="ghost" asChild>
								<Link href="/profile">Make my profile public</Link>
							</Button>
						</div>
					</div>
				</section>
			</main>

			<Footer />
		</div>
	);
}
