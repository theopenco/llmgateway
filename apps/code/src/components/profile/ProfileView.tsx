"use client";

import { Calendar, Coins, Flame, Github, Hash, Zap } from "lucide-react";
import Link from "next/link";

import {
	AGENTS,
	formatTokens,
	type AgentDefinition,
} from "@/app/dashboard/components/coding-agents-shared";
import { ProfilePassport } from "@/components/profile/passport/ProfilePassport";
import { ProfileHeatmap } from "@/components/profile/ProfileHeatmap";
import {
	ProfileShareActions,
	XIcon,
} from "@/components/profile/ProfileShareActions";
import { ProfileTokensChart } from "@/components/profile/ProfileTokensChart";
import { ProfileViewerCta } from "@/components/profile/ProfileViewerCta";
import { ProfileWrapped } from "@/components/profile/ProfileWrapped";
import { useAppConfig } from "@/lib/config";
import { resolveCanonicalModel } from "@/lib/model-family";

import { getProviderIcon } from "@llmgateway/shared/components";

import type { paths } from "@/lib/api/v1";

export type ProfileData =
	paths["/user/profile"]["get"]["responses"][200]["content"]["application/json"]["profile"];

const AGENT_BY_SOURCE = new Map<string, AgentDefinition>();
for (const agent of AGENTS) {
	for (const source of agent.sources) {
		AGENT_BY_SOURCE.set(source.toLowerCase(), agent);
	}
}

function agentForSource(source: string): AgentDefinition | undefined {
	return AGENT_BY_SOURCE.get(source.toLowerCase());
}

interface CanonicalModelUsage {
	id: string;
	name: string;
	iconKey: string;
	known: boolean;
	requestCount: number;
}

// Collapse the raw (model, provider) usage rows into canonical models, summing
// requests across every provider that served the same model.
function aggregateCanonicalModels(
	rows: ProfileData["models"],
): CanonicalModelUsage[] {
	const byCanonical = new Map<string, CanonicalModelUsage>();
	for (const row of rows) {
		const resolved = resolveCanonicalModel(row.id);
		const existing = byCanonical.get(resolved.id);
		if (existing) {
			existing.requestCount += row.requestCount;
		} else {
			byCanonical.set(resolved.id, {
				id: resolved.id,
				name: resolved.name,
				// Unknown models have no family, so fall back to the serving
				// provider's logo rather than the raw model string.
				iconKey: resolved.known ? resolved.iconKey : row.provider,
				known: resolved.known,
				requestCount: row.requestCount,
			});
		}
	}
	return Array.from(byCanonical.values()).sort(
		(a, b) => b.requestCount - a.requestCount,
	);
}

function formatCompact(n: number): string {
	return new Intl.NumberFormat(undefined, {
		notation: "compact",
		maximumFractionDigits: 1,
	}).format(n);
}

function joinedLabel(iso: string): string {
	const created = new Date(iso);
	const days = Math.max(
		0,
		Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24)),
	);
	if (days === 0) {
		return "Joined today";
	}
	if (days < 60) {
		return `Joined ${days} day${days === 1 ? "" : "s"} ago`;
	}
	if (days < 730) {
		const months = Math.round(days / 30);
		return `Joined ${months} month${months === 1 ? "" : "s"} ago`;
	}
	const years = Math.floor(days / 365);
	return `Joined ${years} year${years === 1 ? "" : "s"} ago`;
}

function initials(name: string | null, username: string | null): string {
	const source = name?.trim() || username || "?";
	const parts = source.split(/\s+/).filter(Boolean);
	if (parts.length >= 2) {
		return (parts[0][0] + parts[1][0]).toUpperCase();
	}
	return source.slice(0, 2).toUpperCase();
}

function StatCard({
	label,
	value,
	icon: Icon,
}: {
	label: string;
	value: string;
	icon: typeof Coins;
}) {
	return (
		<div className="rounded-xl border bg-card p-4">
			<div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
				<Icon className="h-3.5 w-3.5" />
				{label}
			</div>
			<div className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
				{value}
			</div>
		</div>
	);
}

export function ProfileView({ profile }: { profile: ProfileData }) {
	const displayName =
		profile.name?.trim() || profile.username || "DevPass user";
	const topAgent =
		profile.agents.length > 0 ? agentForSource(profile.agents[0].source) : null;
	const { uiUrl } = useAppConfig();
	const canonicalModels = aggregateCanonicalModels(profile.models);

	return (
		<div className="mx-auto w-full max-w-5xl">
			{/* Identity header */}
			<div className="flex items-center gap-4">
				<div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-2xl ring-1 ring-border">
					{profile.image ? (
						<img
							src={profile.image}
							alt={displayName}
							className="h-full w-full object-cover"
						/>
					) : (
						<div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 text-lg font-semibold text-emerald-600 dark:text-emerald-400">
							{initials(profile.name, profile.username)}
						</div>
					)}
				</div>
				<div className="min-w-0">
					<h1 className="truncate text-2xl font-semibold tracking-tight">
						{displayName}
					</h1>
					{profile.username && (
						<p className="text-sm text-muted-foreground">@{profile.username}</p>
					)}
				</div>
				<div className="ml-auto flex-shrink-0 self-start">
					<ProfileShareActions
						profile={profile}
						location="profile_header"
						variant="compact"
					/>
				</div>
			</div>

			{/* Interactive 3D passport */}
			<div className="mt-8">
				<ProfilePassport profile={profile} />
			</div>

			{/* Wrapped card + share toolkit */}
			<div className="mt-8">
				<ProfileWrapped profile={profile} />
			</div>

			<div className="mt-8 grid gap-8 lg:grid-cols-[240px_1fr]">
				{/* Sidebar */}
				<aside className="space-y-4 text-sm">
					<div className="flex items-center gap-2 text-muted-foreground">
						<Calendar className="h-4 w-4" />
						<span>{joinedLabel(profile.createdAt)}</span>
					</div>

					{profile.bio && (
						<p className="leading-relaxed text-foreground/90">{profile.bio}</p>
					)}

					<div className="space-y-2">
						{profile.xUsername && (
							<a
								href={`https://x.com/${profile.xUsername.replace(/^@/, "")}`}
								target="_blank"
								rel="noopener noreferrer"
								className="flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
							>
								<XIcon className="h-4 w-4" />
								<span>@{profile.xUsername.replace(/^@/, "")}</span>
							</a>
						)}
						{profile.githubUsername && (
							<a
								href={`https://github.com/${profile.githubUsername.replace(/^@/, "")}`}
								target="_blank"
								rel="noopener noreferrer"
								className="flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
							>
								<Github className="h-4 w-4" />
								<span>{profile.githubUsername.replace(/^@/, "")}</span>
							</a>
						)}
					</div>

					{topAgent && (
						<div className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5">
							<topAgent.icon className="h-4 w-4" />
							<span className="text-sm font-medium">{topAgent.label}</span>
						</div>
					)}
				</aside>

				{/* Main */}
				<div className="min-w-0 space-y-8">
					{/* Stats */}
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
						<StatCard
							label="Tokens"
							value={formatTokens(profile.stats.totalTokens)}
							icon={Coins}
						/>
						<StatCard
							label="Requests"
							value={formatCompact(profile.stats.totalRequests)}
							icon={Zap}
						/>
						<StatCard
							label="Current streak"
							value={`${profile.stats.currentStreak}d`}
							icon={Flame}
						/>
						<StatCard
							label="Longest streak"
							value={`${profile.stats.longestStreak}d`}
							icon={Flame}
						/>
					</div>

					{/* Heatmap */}
					<section className="rounded-2xl border bg-card p-5">
						<div className="mb-4 flex items-center justify-between">
							<h2 className="text-sm font-semibold">Coding activity</h2>
							<p className="text-xs text-muted-foreground">
								{profile.stats.activeDays} active days in the last year
							</p>
						</div>
						<ProfileHeatmap activity={profile.activity} />
					</section>

					{/* Coding agents */}
					{profile.agents.length > 0 && (
						<section>
							<h2 className="mb-3 text-sm font-semibold">Coding agents</h2>
							<div className="flex flex-wrap gap-2">
								{profile.agents.map((a) => {
									const agent = agentForSource(a.source);
									const Icon = agent?.icon;
									return (
										<div
											key={a.source}
											className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2"
										>
											{Icon && <Icon className="h-4 w-4" />}
											<span className="text-sm font-medium">
												{agent?.label ?? a.source}
											</span>
											<span className="text-xs text-muted-foreground tabular-nums">
												{formatTokens(a.totalTokens)}
											</span>
										</div>
									);
								})}
							</div>
						</section>
					)}

					{/* Models */}
					{canonicalModels.length > 0 && (
						<section>
							<h2 className="mb-3 text-sm font-semibold">Models</h2>
							<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
								{canonicalModels.map((model) => {
									const Icon = getProviderIcon(model.iconKey);
									const content = (
										<>
											{Icon && <Icon className="h-5 w-5 flex-shrink-0" />}
											<span className="min-w-0 flex-1 truncate text-sm font-medium">
												{model.name}
											</span>
											<span className="text-xs text-muted-foreground tabular-nums">
												{model.requestCount.toLocaleString()}
											</span>
										</>
									);
									const className =
										"group relative flex items-center gap-2.5 overflow-hidden rounded-xl border bg-card p-3.5 transition-colors hover:border-emerald-500/40 hover:bg-accent";
									return model.known ? (
										<a
											key={model.id}
											href={`${uiUrl}/models/${encodeURIComponent(model.id)}`}
											target="_blank"
											rel="noopener noreferrer"
											className={className}
										>
											{content}
										</a>
									) : (
										<div key={model.id} className={className}>
											{content}
										</div>
									);
								})}
							</div>
						</section>
					)}

					{/* Tokens chart */}
					<section className="rounded-2xl border bg-card p-5">
						<div className="mb-2 flex items-center gap-1.5">
							<Hash className="h-4 w-4 text-muted-foreground" />
							<h2 className="text-sm font-semibold">Tokens over time</h2>
							<span className="ml-auto text-xs text-muted-foreground">
								Last 30 days
							</span>
						</div>
						<ProfileTokensChart activity={profile.activity} />
					</section>
				</div>
			</div>

			{/* Convert logged-out visitors */}
			<ProfileViewerCta profile={profile} />

			{/* Powered by */}
			<div className="mt-10 border-t pt-6 text-center text-xs text-muted-foreground">
				<Link href="/" className="transition-colors hover:text-foreground">
					Powered by{" "}
					<span className="font-semibold text-emerald-600 dark:text-emerald-400">
						DevPass
					</span>{" "}
					— one key, every model
				</Link>
			</div>
		</div>
	);
}
