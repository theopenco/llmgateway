"use client";

import { Check, Copy, Flame, Link2, Sparkles } from "lucide-react";
import { useState } from "react";

import {
	AGENTS,
	formatTokens,
	type AgentDefinition,
} from "@/app/dashboard/components/coding-agents-shared";
import { Button } from "@/components/ui/button";

import type { ProfileData } from "@/components/profile/ProfileView";

const SITE_URL = "https://devpass.llmgateway.io";

const AGENT_BY_SOURCE = new Map<string, AgentDefinition>();
for (const agent of AGENTS) {
	for (const source of agent.sources) {
		AGENT_BY_SOURCE.set(source.toLowerCase(), agent);
	}
}

function useCopy() {
	const [copied, setCopied] = useState(false);
	const copy = async (text: string) => {
		if (!navigator.clipboard?.writeText) {
			return;
		}
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			setCopied(false);
		}
	};
	return { copied, copy };
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
	const linkCopy = useCopy();
	const badgeCopy = useCopy();

	const handle = profile.username ?? "";
	const displayName = profile.name?.trim() || handle || "DevPass user";
	const profileUrl = `${SITE_URL}/profiles/${handle}`;
	const topAgent =
		profile.agents.length > 0
			? AGENT_BY_SOURCE.get(profile.agents[0].source.toLowerCase())
			: undefined;

	const badgeMarkdown = `[![Powered by DevPass](${SITE_URL}/devpass-badge.svg)](${profileUrl})`;

	const tweetText = `My DevPass coding profile: ${formatTokens(
		profile.stats.totalTokens,
	)} tokens routed, ${profile.stats.activeDays} active days, ${
		profile.stats.currentStreak
	}-day streak. One key, every model.`;
	const tweetUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(
		tweetText,
	)}&url=${encodeURIComponent(profileUrl)}`;

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
						devpass.llmgateway.io/profiles/{handle}
					</div>
				</div>
			</div>

			{/* Share toolkit */}
			<div className="rounded-2xl border bg-card p-4 sm:p-5">
				<div className="flex flex-col gap-4 sm:flex-row sm:items-center">
					<div className="flex flex-shrink-0 gap-2">
						<Button className="gap-2" asChild>
							<a href={tweetUrl} target="_blank" rel="noopener noreferrer">
								<svg
									viewBox="0 0 24 24"
									className="h-4 w-4 fill-current"
									aria-hidden="true"
								>
									<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
								</svg>
								Share on X
							</a>
						</Button>
						<Button
							variant="outline"
							className="gap-2"
							onClick={() => linkCopy.copy(profileUrl)}
						>
							{linkCopy.copied ? (
								<Check className="h-4 w-4 text-emerald-500" />
							) : (
								<Link2 className="h-4 w-4" />
							)}
							{linkCopy.copied ? "Copied" : "Copy link"}
						</Button>
					</div>

					<div className="min-w-0 flex-1">
						<p className="mb-1.5 text-xs font-medium text-muted-foreground">
							README badge
						</p>
						<div className="relative overflow-hidden rounded-lg border border-border/60 bg-background">
							<pre className="overflow-x-auto px-3 py-2.5 pr-10 font-mono text-[11px] leading-5 text-foreground/80">
								{badgeMarkdown}
							</pre>
							<button
								type="button"
								onClick={() => badgeCopy.copy(badgeMarkdown)}
								aria-label="Copy badge markdown"
								className="absolute right-1.5 top-1.5 rounded-md border border-border/60 bg-card p-1.5 text-muted-foreground transition-colors hover:text-foreground"
							>
								{badgeCopy.copied ? (
									<Check className="h-3.5 w-3.5 text-emerald-500" />
								) : (
									<Copy className="h-3.5 w-3.5" />
								)}
							</button>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
