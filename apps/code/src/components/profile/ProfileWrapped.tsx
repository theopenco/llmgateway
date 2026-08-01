"use client";

import { Flame, Sparkles } from "lucide-react";

import {
	AGENTS,
	formatTokens,
	type AgentDefinition,
} from "@/app/dashboard/components/coding-agents-shared";
import {
	PROFILE_SITE_URL,
	ProfileShareActions,
} from "@/components/profile/ProfileShareActions";
import { Button } from "@/components/ui/button";
import { useUser } from "@/hooks/useUser";

import type { ProfileData } from "@/components/profile/ProfileView";

const AGENT_BY_SOURCE = new Map<string, AgentDefinition>();
for (const agent of AGENTS) {
	for (const source of agent.sources) {
		AGENT_BY_SOURCE.set(source.toLowerCase(), agent);
	}
}

function WrappedStat({ value, label }: { value: string; label: string }) {
	return (
		<div>
			<div className="whitespace-nowrap text-xl font-bold tabular-nums text-white">
				{value}
			</div>
			<div className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-white/60">
				{label}
			</div>
		</div>
	);
}

export function ProfileWrapped({ profile }: { profile: ProfileData }) {
	const { user } = useUser();

	const handle = profile.username ?? "";
	const displayName = profile.name?.trim() || handle || "DevPass user";
	const isOwner = !!user && (user.username ?? "") === handle;
	const topAgent =
		profile.agents.length > 0
			? AGENT_BY_SOURCE.get(profile.agents[0].source.toLowerCase())
			: undefined;

	return (
		<div className="space-y-3">
			{/* Wrapped card — full-width banner, built to screenshot */}
			<div className="relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-[#07120d] p-6">
				<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_80%_at_90%_-10%,_rgba(16,185,129,0.28),_transparent)]" />
				<div className="relative">
					<div className="flex items-center justify-between">
						<div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-400">
							<Sparkles className="h-3.5 w-3.5" />
							Coding wrapped
						</div>
						<span className="text-xs font-medium text-white/50">DevPass</span>
					</div>

					<div className="mt-5 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
						<div>
							<p className="text-sm text-white/70">{displayName} routed</p>
							<div className="mt-1 flex items-baseline gap-2">
								<span className="text-4xl font-bold tabular-nums text-white sm:text-5xl">
									{formatTokens(profile.stats.totalTokens)}
								</span>
								<span className="text-sm font-medium text-white/60">
									tokens this year
								</span>
							</div>
						</div>

						<div className="flex gap-8 sm:gap-10">
							<WrappedStat
								value={`${profile.stats.activeDays}`}
								label="Active days"
							/>
							<WrappedStat
								value={`${profile.stats.currentStreak}d`}
								label="Streak"
							/>
							<WrappedStat
								value={topAgent?.label ?? "Multi-tool"}
								label="Top agent"
							/>
						</div>
					</div>

					<div className="mt-6 flex items-center gap-1.5 border-t border-white/10 pt-4 text-xs text-white/50">
						<Flame className="h-3.5 w-3.5 text-emerald-400" />
						{handle
							? `${PROFILE_SITE_URL.replace("https://", "")}/profiles/${handle}`
							: PROFILE_SITE_URL.replace("https://", "")}
					</div>
				</div>
			</div>

			{/* Share toolkit */}
			<div className="rounded-2xl border bg-card p-4 sm:p-5">
				{handle ? (
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div className="space-y-0.5">
							<p className="text-sm font-semibold">
								{isOwner ? "Share your stats" : "Share this profile"}
							</p>
							<p className="text-xs text-muted-foreground">
								{isOwner
									? "Post your wrapped to X or LinkedIn, or copy your link."
									: "Post these stats to X or LinkedIn, or copy the link."}
							</p>
						</div>
						<ProfileShareActions profile={profile} location="profile_wrapped" />
					</div>
				) : (
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div className="space-y-0.5">
							<p className="text-sm font-semibold">Share your stats</p>
							<p className="text-xs text-muted-foreground">
								Claim your handle to get a public link you can share on X and
								LinkedIn.
							</p>
						</div>
						<Button variant="outline" asChild>
							<a href="#username">Choose a username</a>
						</Button>
					</div>
				)}
			</div>
		</div>
	);
}
