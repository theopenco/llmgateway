"use client";

import Link from "next/link";

import { formatTokens } from "@/app/dashboard/components/coding-agents-shared";
import { GetDevPassButton } from "@/components/GetDevPassButton";
import { Button } from "@/components/ui/button";
import { useUser } from "@/hooks/useUser";

import type { ProfileData } from "@/components/profile/ProfileView";

export function ProfileViewerCta({ profile }: { profile: ProfileData }) {
	const { user, isLoading } = useUser();

	// Only pitch logged-out visitors — existing users already have a key.
	if (isLoading || user) {
		return null;
	}

	const displayName =
		profile.name?.trim() || profile.username || "This developer";

	return (
		<section className="relative mt-10 overflow-hidden rounded-2xl border border-emerald-500/20 bg-card p-8 text-center">
			<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_60%_at_50%_-10%,_rgba(16,185,129,0.12),_transparent)]" />
			<div className="relative">
				<p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-400">
					Powered by DevPass
				</p>
				<h2 className="mx-auto mt-3 max-w-xl text-2xl font-bold tracking-tight sm:text-3xl">
					One key. Every model. Three flat prices.
				</h2>
				<p className="mx-auto mt-3 max-w-xl text-muted-foreground">
					{displayName} has routed {formatTokens(profile.stats.totalTokens)}{" "}
					tokens through DevPass — Claude, GPT, Gemini, GLM and more, all from a
					single key. Start your own and turn every dollar into $3 of model
					usage.
				</p>
				<div className="mt-7 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
					<GetDevPassButton
						cta="get_started"
						location="profile_viewer_cta"
						signupHref="/signup?plan=pro"
						showArrow
					/>
					<Button size="lg" variant="ghost" asChild>
						<Link href="/leaderboard">See the leaderboard</Link>
					</Button>
				</div>
			</div>
		</section>
	);
}
