"use client";

import {
	CalendarClock,
	Gauge,
	Infinity as InfinityIcon,
	Zap,
} from "lucide-react";
import Link from "next/link";

import { currencyFormatter } from "@/components/analytics/chart-helpers";
import { Badge } from "@/lib/components/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { Progress } from "@/lib/components/progress";
import { Skeleton } from "@/lib/components/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/lib/components/table";
import { useDashboardContext } from "@/lib/dashboard-context";
import { useApi } from "@/lib/fetch-client";

import type { ReactNode } from "react";

const usd = (n: number) => currencyFormatter.format(n);
const pct = (used: number, cap: number) =>
	cap > 0 ? Math.min(100, (used / cap) * 100) : 0;

const ENDPOINT_LABELS: Record<string, string> = {
	chat_completions: "Chat completions",
	messages: "Messages (Anthropic)",
	responses: "Responses",
	embeddings: "Embeddings",
	moderations: "Moderations",
	rerank: "Rerank",
	models: "Models",
	ocr: "OCR",
	images: "Images",
	audio_speech: "Speech",
	audio_transcriptions: "Transcriptions",
	videos: "Videos",
	realtime: "Realtime (session mint)",
	key: "Key info",
	credits: "Credits",
	ai_sdk: "AI SDK protocol",
};

export function LimitsClient() {
	const { selectedOrganization } = useDashboardContext();
	const orgId = selectedOrganization?.id ?? "";
	const api = useApi();

	const { data, isLoading, isError } = api.useQuery(
		"get",
		"/orgs/{id}/limits",
		{ params: { path: { id: orgId } } },
		{ enabled: !!orgId },
	);

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="mx-auto w-full max-w-4xl space-y-6">
					<div>
						<h2 className="text-3xl font-bold tracking-tight">Limits</h2>
						<p className="text-muted-foreground mt-1">
							Your organization's rate limits and daily/monthly spend caps. They
							grow automatically with account age and lifetime usage.
						</p>
					</div>

					{isLoading && (
						<div className="space-y-6">
							<Skeleton className="h-40 w-full" />
							<Skeleton className="h-40 w-full" />
						</div>
					)}

					{isError && (
						<Card>
							<CardContent className="text-muted-foreground py-6">
								Couldn't load your limits right now. Please try again later.
							</CardContent>
						</Card>
					)}

					{data?.enterprise && (
						<Card>
							<CardHeader>
								<CardTitle className="flex items-center gap-2">
									<InfinityIcon className="h-5 w-5" />
									No limits
								</CardTitle>
								<CardDescription>
									Enterprise organizations have no per-organization rate limits
									or spend caps. Throughput is bounded only by your credit
									balance and upstream provider limits.
								</CardDescription>
							</CardHeader>
						</Card>
					)}

					{data && !data.enterprise && (
						<>
							{/* Current tier — the trust-tier ladder only applies to regular
							    (pay-as-you-go) orgs; Dev/Chat plans use flat endpoint limits. */}
							{data.planClass === "regular" && (
								<Card>
									<CardHeader>
										<div className="flex items-center justify-between gap-4">
											<div>
												<CardTitle className="flex items-center gap-2">
													<Gauge className="h-5 w-5" />
													Current tier
												</CardTitle>
												<CardDescription>
													{data.tierOverridden
														? "Your organization's tier has been set by LLM Gateway support."
														: "You qualify by whichever is higher — account age or lifetime credits usage (net of refunds; BYOK usage doesn't count)."}
												</CardDescription>
											</div>
											<Badge className="shrink-0 text-base" variant="secondary">
												Tier {data.tier.tier}
											</Badge>
										</div>
									</CardHeader>
									<CardContent>
										<div className="grid gap-6 sm:grid-cols-3">
											<Metric
												label="Account age"
												value={`${data.accountAgeDays} ${
													data.accountAgeDays === 1 ? "day" : "days"
												}`}
											/>
											<Metric
												label="Lifetime usage"
												value={usd(data.lifetimeSpendUsd)}
											/>
											<Metric
												label="Rate multiplier"
												value={`${data.tier.rpmMultiplier}×`}
											/>
										</div>
									</CardContent>
								</Card>
							)}

							{/* Spend caps */}
							{data.capsApply && (
								<Card>
									<CardHeader>
										<CardTitle>Spend caps</CardTitle>
										<CardDescription>
											Paid usage is capped per day (resets at UTC midnight) and
											per calendar month. Free models don't count.
										</CardDescription>
									</CardHeader>
									<CardContent className="space-y-6">
										<CapBar
											label="Daily"
											used={data.usage.dailySpentUsd}
											cap={data.tier.dailyCapUsd}
										/>
										<CapBar
											label="Monthly"
											used={data.usage.monthlySpentUsd}
											cap={data.tier.monthlyCapUsd}
										/>
									</CardContent>
								</Card>
							)}

							{/* Top-up allowance */}
							{data.topUp && (
								<Card>
									<CardHeader>
										<CardTitle>Top-up allowance</CardTitle>
										<CardDescription>
											How much you can add to your credit balance per rolling
											24-hour window. The allowance grows with your tier.
										</CardDescription>
									</CardHeader>
									<CardContent>
										<CapBar
											label="Rolling 24h"
											used={data.topUp.usedUsd}
											cap={data.topUp.capUsd}
										/>
									</CardContent>
								</Card>
							)}

							{/* Next tier — hidden when support pinned the tier; progression
							    does not apply to a pinned org. */}
							{data.planClass === "regular" && !data.tierOverridden && (
								<Card>
									<CardHeader>
										<CardTitle className="flex items-center gap-2">
											<Zap className="h-5 w-5" />
											{data.nextTier
												? `Reach Tier ${data.nextTier.tier}`
												: "Highest tier reached"}
										</CardTitle>
										<CardDescription>
											{data.nextTier
												? "Reach the next tier by waiting, or by growing usage once your account is old enough."
												: "You're already on the highest trust tier."}
										</CardDescription>
									</CardHeader>
									{data.nextTier && (
										<CardContent className="space-y-4">
											<div className="grid gap-4 sm:grid-cols-2">
												<NextPath
													icon={<CalendarClock className="h-4 w-4" />}
													title="Keep your account active"
													detail={
														data.nextTier.daysUntilQualify > 0
															? `${data.nextTier.daysUntilQualify} more ${
																	data.nextTier.daysUntilQualify === 1
																		? "day"
																		: "days"
																} of account age`
															: "Age requirement met"
													}
												/>
												<NextPath
													icon={<Zap className="h-4 w-4" />}
													title="Grow usage"
													detail={growUsageDetail(data.nextTier)}
												/>
											</div>
											<div className="text-muted-foreground border-t pt-4 text-sm">
												Tier {data.nextTier.tier} unlocks{" "}
												<span className="text-foreground font-medium">
													{usd(data.nextTier.dailyCapUsd)}/day
												</span>{" "}
												and{" "}
												<span className="text-foreground font-medium">
													{usd(data.nextTier.monthlyCapUsd)}/month
												</span>{" "}
												spend, a{" "}
												<span className="text-foreground font-medium">
													{usd(data.nextTier.topUpDailyCapUsd)}/24h
												</span>{" "}
												top-up allowance, plus a{" "}
												<span className="text-foreground font-medium">
													{data.nextTier.rpmMultiplier}×
												</span>{" "}
												rate multiplier.
											</div>
										</CardContent>
									)}
								</Card>
							)}

							{/* Per-endpoint RPM */}
							{data.rateLimitsApply && (
								<Card>
									<CardHeader>
										<CardTitle>Requests per minute</CardTitle>
										<CardDescription>
											Per-endpoint request limits at your current tier, scoped
											to your organization.
										</CardDescription>
									</CardHeader>
									<CardContent>
										<Table>
											<TableHeader>
												<TableRow>
													<TableHead>Endpoint</TableHead>
													<TableHead className="hidden sm:table-cell">
														Path
													</TableHead>
													<TableHead className="text-right">
														Requests / min
													</TableHead>
												</TableRow>
											</TableHeader>
											<TableBody>
												{data.endpoints.map((e) => (
													<TableRow key={e.key}>
														<TableCell className="font-medium">
															{ENDPOINT_LABELS[e.key] ?? e.key}
														</TableCell>
														<TableCell className="text-muted-foreground hidden font-mono text-xs sm:table-cell">
															{e.path}
														</TableCell>
														<TableCell className="text-right tabular-nums">
															{e.rpm > 0 ? e.rpm.toLocaleString() : "Unlimited"}
														</TableCell>
													</TableRow>
												))}
											</TableBody>
										</Table>
									</CardContent>
								</Card>
							)}

							<p className="text-muted-foreground text-sm">
								Need higher limits?{" "}
								<Link
									href="/enterprise"
									className="text-foreground underline underline-offset-4"
								>
									Enterprise
								</Link>{" "}
								organizations have no rate limits or caps at all —{" "}
								<a
									href="mailto:contact@llmgateway.io"
									className="text-foreground underline underline-offset-4"
								>
									contact us
								</a>{" "}
								to learn more.
							</p>
						</>
					)}
				</div>
			</div>
		</div>
	);
}

function growUsageDetail(nextTier: {
	spendUsdUntilQualify: number;
	minAgeDaysRequired: number;
	daysUntilSpendPathUnlocks: number;
}): string {
	const days = nextTier.daysUntilSpendPathUnlocks;
	const dayWord = (n: number) => (n === 1 ? "day" : "days");
	if (nextTier.spendUsdUntilQualify > 0) {
		return days > 0
			? `${usd(nextTier.spendUsdUntilQualify)} more lifetime spend, once your account is ${nextTier.minAgeDaysRequired} ${dayWord(nextTier.minAgeDaysRequired)} old`
			: `${usd(nextTier.spendUsdUntilQualify)} more lifetime spend`;
	}
	return days > 0
		? `Spend met — ${days} more ${dayWord(days)} of account age`
		: "Spend requirement met";
}

function Metric({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<p className="text-muted-foreground text-sm">{label}</p>
			<p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
		</div>
	);
}

function CapBar({
	label,
	used,
	cap,
}: {
	label: string;
	used: number;
	cap: number;
}) {
	return (
		<div className="space-y-2">
			<div className="flex items-baseline justify-between text-sm">
				<span className="font-medium">{label}</span>
				<span className="text-muted-foreground tabular-nums">
					{usd(used)} / {usd(cap)}
				</span>
			</div>
			<Progress value={pct(used, cap)} className="h-2" />
		</div>
	);
}

function NextPath({
	icon,
	title,
	detail,
}: {
	icon: ReactNode;
	title: string;
	detail: string;
}) {
	return (
		<div className="rounded-lg border p-4">
			<div className="text-muted-foreground flex items-center gap-2 text-sm">
				{icon}
				{title}
			</div>
			<p className="mt-1 font-medium">{detail}</p>
		</div>
	);
}
