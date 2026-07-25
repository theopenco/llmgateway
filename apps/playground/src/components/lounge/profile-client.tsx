"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
	ArrowLeft,
	AudioLines,
	CalendarDays,
	Film,
	Flame,
	ImagePlus,
	MessageSquare,
	MessageSquarePlus,
	Sparkles,
	Trophy,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLoungePoints } from "@/hooks/useLoungePoints";
import { useUpdateUser, useUser } from "@/hooks/useUser";
import { useApi } from "@/lib/fetch-client";

const BREAKDOWN_LABELS: Record<
	string,
	{ label: string; icon: typeof MessageSquare }
> = {
	chat_message: { label: "Messages sent", icon: MessageSquare },
	chat_created: { label: "Chats started", icon: MessageSquarePlus },
	image_generation: { label: "Images created", icon: ImagePlus },
	video_generation: { label: "Videos created", icon: Film },
	audio_generation: { label: "Audio created", icon: AudioLines },
};

const EARNING_HINTS = [
	{ label: "Send a message", points: 5 },
	{ label: "Start a chat", points: 10 },
	{ label: "Create an image", points: 10 },
	{ label: "Create audio", points: 10 },
	{ label: "Create a video", points: 15 },
];

function StatTile({
	label,
	value,
	icon: Icon,
}: {
	label: string;
	value: string;
	icon: typeof Sparkles;
}) {
	return (
		<div className="rounded-xl border px-4 py-3.5">
			<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
				<Icon className="h-3.5 w-3.5" />
				{label}
			</div>
			<div className="mt-1.5 text-xl font-semibold tabular-nums">{value}</div>
		</div>
	);
}

export function LoungeProfileClient() {
	const { user, isLoading: isUserLoading } = useUser();
	const api = useApi();
	const queryClient = useQueryClient();
	const updateUser = useUpdateUser();
	const [usernameInput, setUsernameInput] = useState("");

	const { data, isLoading: isStatsLoading } = useLoungePoints();

	if (isUserLoading || (user && isStatsLoading)) {
		return (
			<main className="mx-auto max-w-3xl px-4 py-16 sm:py-20">
				<div className="h-40 animate-pulse rounded-xl bg-muted" />
			</main>
		);
	}

	if (!user) {
		return (
			<main className="mx-auto flex max-w-3xl flex-col items-center px-4 py-24 text-center">
				<Sparkles className="mb-4 h-8 w-8 text-lounge-gold" />
				<h1 className="font-display text-2xl font-semibold">
					Sign in to see your profile
				</h1>
				<p className="mt-2 max-w-md text-sm text-muted-foreground">
					Your Lounge profile tracks the points, streaks, and level you earn by
					chatting and creating.
				</p>
				<Button asChild className="mt-6">
					<Link href="/login">Sign in</Link>
				</Button>
			</main>
		);
	}

	const stats = data?.stats;
	const onLeaderboard = Boolean(user.profilePublic && user.username);

	const joinLeaderboard = () => {
		const username = (user.username ?? usernameInput).trim().toLowerCase();
		if (!username) {
			toast.error("Pick a username first");
			return;
		}
		updateUser.mutate(
			{
				body: user.username
					? { profilePublic: true }
					: { username, profilePublic: true },
			},
			{
				onSuccess: () => {
					toast.success("You're on the leaderboard!");
					void queryClient.invalidateQueries({
						queryKey: api.queryOptions("get", "/user/me").queryKey,
					});
					void queryClient.invalidateQueries({
						queryKey: api.queryOptions("get", "/lounge/points/me").queryKey,
					});
				},
				onError: (error) => {
					const message =
						error && typeof error === "object" && "message" in error
							? String((error as { message?: unknown }).message)
							: "Could not update your profile";
					toast.error(message);
				},
			},
		);
	};

	const progressSpan = stats ? stats.nextLevelAt - stats.currentLevelAt : 1;
	const progressPct = stats
		? Math.min(
				100,
				Math.round(
					((stats.totalPoints - stats.currentLevelAt) / progressSpan) * 100,
				),
			)
		: 0;

	return (
		<main className="mx-auto max-w-3xl px-4 py-16 sm:py-20">
			<Link
				href="/"
				className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
			>
				<ArrowLeft className="h-4 w-4" />
				Back to chat
			</Link>

			<header className="mb-10">
				<p className="mb-4 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.28em] text-lounge-gold">
					<span aria-hidden className="h-px w-8 bg-lounge-gold/50" />
					The Lounge · Membership Profile
				</p>
				<div className="flex flex-wrap items-end justify-between gap-4">
					<div>
						<h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
							{user.name ?? "Member"}
						</h1>
						<p className="mt-1 text-sm text-muted-foreground">
							{user.username ? `@${user.username}` : user.email}
						</p>
					</div>
					{stats ? (
						<span className="inline-flex items-center gap-1.5 rounded-full border border-lounge-gold/30 bg-lounge-gold/10 px-3 py-1 text-sm font-medium text-lounge-gold">
							<Sparkles className="h-4 w-4" />
							Lv {stats.level} · {stats.levelTitle}
						</span>
					) : null}
				</div>
			</header>

			{stats ? (
				<>
					<section className="mb-8 rounded-xl border px-5 py-4">
						<div className="flex flex-wrap items-baseline justify-between gap-2">
							<div>
								<span className="text-3xl font-semibold tabular-nums">
									{stats.totalPoints.toLocaleString()}
								</span>
								<span className="ml-2 text-sm text-muted-foreground">
									points
								</span>
							</div>
							<span className="text-xs text-muted-foreground">
								{Math.max(
									stats.nextLevelAt - stats.totalPoints,
									0,
								).toLocaleString()}{" "}
								to Lv {stats.level + 1}
							</span>
						</div>
						<div
							className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
							role="progressbar"
							aria-valuenow={progressPct}
							aria-valuemin={0}
							aria-valuemax={100}
							aria-label="Progress to next level"
						>
							<div
								className="h-full rounded-full bg-lounge-gold transition-all"
								style={{ width: `${progressPct}%` }}
							/>
						</div>
					</section>

					<section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
						<StatTile
							label="Today"
							value={`+${stats.todayPoints.toLocaleString()}`}
							icon={Sparkles}
						/>
						<StatTile
							label="Global rank"
							value={stats.rank ? `#${stats.rank.toLocaleString()}` : "—"}
							icon={Trophy}
						/>
						<StatTile
							label="Current streak"
							value={`${stats.currentStreak}d`}
							icon={Flame}
						/>
						<StatTile
							label="Longest streak"
							value={`${stats.longestStreak}d`}
							icon={Flame}
						/>
						<StatTile
							label="Active days"
							value={String(stats.activeDays)}
							icon={CalendarDays}
						/>
					</section>

					<section className="mb-8">
						<h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
							Points earned
						</h2>
						{stats.breakdown.length === 0 ? (
							<div className="rounded-xl border border-dashed px-5 py-8 text-center text-sm text-muted-foreground">
								No points yet — send a message or create something to get
								started.
							</div>
						) : (
							<ul className="divide-y divide-border overflow-hidden rounded-xl border">
								{stats.breakdown.map((row) => {
									const meta = BREAKDOWN_LABELS[row.kind];
									const Icon = meta?.icon ?? Sparkles;
									return (
										<li
											key={row.kind}
											className="flex items-center gap-3 px-4 py-3 text-sm"
										>
											<Icon className="h-4 w-4 text-muted-foreground" />
											<span className="flex-1">{meta?.label ?? row.kind}</span>
											<span className="text-xs text-muted-foreground">
												×{row.count.toLocaleString()}
											</span>
											<span className="w-20 text-right font-medium tabular-nums">
												{row.points.toLocaleString()}
											</span>
										</li>
									);
								})}
							</ul>
						)}
					</section>
				</>
			) : null}

			<section className="mb-8 rounded-xl border border-lounge-gold/25 bg-lounge-gold/[0.06] px-5 py-4">
				<h2 className="flex items-center gap-2 text-sm font-semibold">
					<Trophy className="h-4 w-4 text-lounge-gold" />
					Leaderboard
				</h2>
				{onLeaderboard ? (
					<p className="mt-2 text-sm text-muted-foreground">
						You&apos;re live on the leaderboard as{" "}
						<span className="font-medium text-foreground">
							@{user.username}
						</span>
						.
					</p>
				) : (
					<>
						<p className="mt-2 text-sm text-muted-foreground">
							Claim a handle and make your profile public to appear on the
							Lounge leaderboard. Only your name, picture, level, and points are
							shown — never your chats.
						</p>
						{!user.username && (
							<Input
								value={usernameInput}
								onChange={(event) =>
									setUsernameInput(event.target.value.toLowerCase())
								}
								placeholder="pick-a-username"
								className="mt-3 max-w-xs"
								maxLength={30}
							/>
						)}
					</>
				)}
				<div className="mt-3 flex flex-wrap gap-2">
					{!onLeaderboard && (
						<Button
							size="sm"
							onClick={joinLeaderboard}
							disabled={updateUser.isPending}
						>
							{updateUser.isPending ? "Joining…" : "Join the leaderboard"}
						</Button>
					)}
					<Button size="sm" variant="outline" asChild>
						<Link href="/leaderboard">View leaderboard</Link>
					</Button>
				</div>
			</section>

			<section>
				<h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
					How to earn points
				</h2>
				<ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
					{EARNING_HINTS.map((hint) => (
						<li
							key={hint.label}
							className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs"
						>
							<span className="text-muted-foreground">{hint.label}</span>
							<span className="font-semibold text-lounge-gold">
								+{hint.points}
							</span>
						</li>
					))}
				</ul>
				<p className="mt-2 text-[11px] text-muted-foreground">
					Daily caps apply per activity, and streaks grow for every day you show
					up.
				</p>
			</section>
		</main>
	);
}
