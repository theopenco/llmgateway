"use client";

import { Check, Copy, Download } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useRef, useState } from "react";

import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { Label } from "@/lib/components/label";
import { Switch } from "@/lib/components/switch";
import { cn } from "@/lib/utils";

import {
	formatCompactNumber,
	formatNumber,
} from "@llmgateway/shared/number-format";

import type { paths } from "@/lib/api/v1";
import type { Route } from "next";

export type WrappedData =
	paths["/orgs/{id}/wrapped"]["get"]["responses"][200]["content"]["application/json"];

interface WrappedClientProps {
	data: WrappedData | null;
	names: Record<string, string>;
	year: number;
	years: number[];
	isCurrentYear: boolean;
}

const COPIED_MS = 2000;
const SITE_URL = "https://llmgateway.io";
const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

function formatDay(date: string) {
	const [, month, day] = date.split("-");
	return `${MONTHS[Number(month) - 1]} ${Number(day)}`;
}

function formatHour(hour: number) {
	return `${String(hour).padStart(2, "0")}:00 UTC`;
}

export function WrappedClient({
	data,
	names,
	year,
	years,
	isCurrentYear,
}: WrappedClientProps) {
	const pathname = usePathname();
	const showNameId = useId();
	const cardRef = useRef<HTMLDivElement>(null);
	const [showName, setShowName] = useState(true);
	const [capturing, setCapturing] = useState(false);
	const [copied, setCopied] = useState(false);

	const name = (id: string) => names[id] ?? id;
	const hasUsage = data !== null && data.totals.requests > 0;
	const topModel = data?.topModels[0];

	const summary = data
		? [
				`${showName ? data.organizationName : "Our team"} on LLM Gateway in ${year}:`,
				`${formatCompactNumber(data.totals.totalTokens)} tokens across ${formatCompactNumber(data.totals.requests)} requests`,
				`${formatNumber(data.modelsUsed)} models from ${formatNumber(data.providersUsed)} providers`,
				topModel ? `Most used: ${name(topModel.modelId)}` : null,
				`${formatNumber(data.activeDays)} active days`,
			]
				.filter((line) => line !== null)
				.join("\n")
		: "";

	const download = async () => {
		const node = cardRef.current;
		if (!node || capturing) {
			return;
		}
		setCapturing(true);
		try {
			const { toPng } = await import("html-to-image");
			const link = document.createElement("a");
			link.href = await toPng(node, { cacheBust: true, pixelRatio: 2 });
			link.download = `llmgateway-wrapped-${year}.png`;
			link.click();
		} finally {
			setCapturing(false);
		}
	};

	const copySummary = async () => {
		await navigator.clipboard.writeText(`${summary}\n${SITE_URL}`);
		setCopied(true);
		setTimeout(() => setCopied(false), COPIED_MS);
	};

	const maxMonthTokens = Math.max(
		1,
		...(data?.months ?? []).map((month) => month.totalTokens),
	);

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-6 p-4 pt-6 md:p-8">
				<div className="flex flex-wrap items-end justify-between gap-4">
					<div>
						<h2 className="text-3xl font-bold tracking-tight">Wrapped</h2>
						<p className="mt-1 text-muted-foreground">
							{isCurrentYear
								? `Your organization's ${year} so far, in UTC.`
								: `Your organization's ${year} in review, in UTC.`}
						</p>
					</div>
					{years.length > 1 ? (
						<nav aria-label="Year" className="flex gap-1 rounded-lg border p-1">
							{years.map((option) => (
								<Link
									key={option}
									href={`${pathname}?year=${option}` as Route}
									aria-current={option === year ? "page" : undefined}
									className={cn(
										"rounded-md px-3 py-1.5 text-sm font-medium tabular-nums",
										option === year
											? "bg-primary text-primary-foreground"
											: "text-muted-foreground hover:bg-muted",
									)}
								>
									{option}
								</Link>
							))}
						</nav>
					) : null}
				</div>

				{data === null ? (
					<Card>
						<CardContent className="pt-6 text-muted-foreground">
							Wrapped is available to organization owners and admins.
						</CardContent>
					</Card>
				) : !hasUsage ? (
					<Card>
						<CardContent className="pt-6 text-muted-foreground">
							No requests in {year} yet. Send your first one and this page fills
							in.
						</CardContent>
					</Card>
				) : (
					<>
						<div className="grid gap-6 xl:grid-cols-[minmax(0,640px)_1fr]">
							<div
								ref={cardRef}
								className="overflow-hidden rounded-2xl bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 p-8 text-white"
							>
								<p className="text-xs font-semibold uppercase tracking-widest text-indigo-200">
									LLM Gateway Wrapped {year}
								</p>
								{showName ? (
									<p className="mt-2 truncate text-lg font-medium">
										{data.organizationName}
									</p>
								) : null}
								<p className="mt-8 text-6xl font-bold tracking-tight tabular-nums">
									{formatCompactNumber(data.totals.totalTokens)}
								</p>
								<p className="mt-1 text-indigo-200">tokens processed</p>
								<dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
									{[
										{
											label: "Requests",
											value: formatCompactNumber(data.totals.requests),
										},
										{ label: "Models", value: formatNumber(data.modelsUsed) },
										{
											label: "Active days",
											value: formatNumber(data.activeDays),
										},
										{
											label: "Longest streak",
											value: `${formatNumber(data.longestStreakDays)}d`,
										},
									].map((stat) => (
										<div key={stat.label}>
											<dt className="text-xs text-indigo-200">{stat.label}</dt>
											<dd className="mt-0.5 text-2xl font-semibold tabular-nums">
												{stat.value}
											</dd>
										</div>
									))}
								</dl>
								{data.topModels.length > 0 ? (
									<div className="mt-8">
										<p className="text-xs text-indigo-200">Top models</p>
										<ol className="mt-2 space-y-2">
											{data.topModels.slice(0, 3).map((model, index) => (
												<li
													key={model.modelId}
													className="flex items-baseline justify-between gap-4"
												>
													<span className="min-w-0 truncate font-medium">
														{index + 1}. {name(model.modelId)}
													</span>
													<span className="shrink-0 text-sm tabular-nums text-indigo-200">
														{model.sharePercent.toFixed(0)}%
													</span>
												</li>
											))}
										</ol>
									</div>
								) : null}
								<p className="mt-8 text-xs text-indigo-300">llmgateway.io</p>
							</div>

							<Card className="h-fit">
								<CardHeader>
									<CardTitle>Share it</CardTitle>
									<CardDescription>
										The card shows totals only. No costs, keys or prompts.
									</CardDescription>
								</CardHeader>
								<CardContent className="space-y-4">
									<div className="flex items-center gap-3">
										<Switch
											id={showNameId}
											checked={showName}
											onCheckedChange={setShowName}
										/>
										<Label htmlFor={showNameId}>Show organization name</Label>
									</div>
									<div className="flex flex-wrap gap-2">
										<Button
											type="button"
											onClick={download}
											disabled={capturing}
										>
											<Download className="size-4" aria-hidden="true" />
											{capturing ? "Rendering" : "Download image"}
										</Button>
										<Button
											type="button"
											variant="outline"
											onClick={copySummary}
										>
											{copied ? (
												<Check className="size-4" aria-hidden="true" />
											) : (
												<Copy className="size-4" aria-hidden="true" />
											)}
											{copied ? "Copied" : "Copy summary"}
										</Button>
										<Button asChild variant="outline">
											<a
												href={`https://x.com/intent/tweet?text=${encodeURIComponent(summary)}&url=${encodeURIComponent(SITE_URL)}`}
												target="_blank"
												rel="noopener noreferrer"
											>
												Post on X
											</a>
										</Button>
									</div>
								</CardContent>
							</Card>
						</div>

						<div className="grid gap-6 lg:grid-cols-3">
							<Card className="lg:col-span-2">
								<CardHeader>
									<CardTitle>Month by month</CardTitle>
									<CardDescription>Tokens processed.</CardDescription>
								</CardHeader>
								<CardContent>
									<ol className="space-y-2">
										{data.months.map((month) => (
											<li
												key={month.month}
												className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-3"
											>
												<span className="text-sm text-muted-foreground">
													{MONTHS[Number(month.month.slice(5, 7)) - 1]}
												</span>
												<span
													className="h-5 rounded bg-primary"
													style={{
														width: `${Math.max((month.totalTokens / maxMonthTokens) * 100, 1)}%`,
													}}
													aria-hidden="true"
												/>
												<span className="text-sm font-medium tabular-nums">
													{formatCompactNumber(month.totalTokens)}
												</span>
											</li>
										))}
									</ol>
								</CardContent>
							</Card>

							<Card>
								<CardHeader>
									<CardTitle>Highlights</CardTitle>
								</CardHeader>
								<CardContent>
									<dl className="space-y-4 text-sm">
										{data.busiestDay ? (
											<div>
												<dt className="text-muted-foreground">Busiest day</dt>
												<dd className="font-medium">
													{formatDay(data.busiestDay.date)} ·{" "}
													{formatNumber(data.busiestDay.requests)} requests
												</dd>
											</div>
										) : null}
										{data.peakHourUtc !== null ? (
											<div>
												<dt className="text-muted-foreground">Peak hour</dt>
												<dd className="font-medium">
													{formatHour(data.peakHourUtc)}
												</dd>
											</div>
										) : null}
										{data.totals.cachedRequests > 0 ? (
											<div>
												<dt className="text-muted-foreground">
													Answered from the gateway cache
												</dt>
												<dd className="font-medium">
													{formatNumber(data.totals.cachedRequests)} requests
												</dd>
											</div>
										) : null}
										{data.totals.cachedTokens > 0 ? (
											<div>
												<dt className="text-muted-foreground">
													Prompt-cached input
												</dt>
												<dd className="font-medium">
													{formatCompactNumber(data.totals.cachedTokens)} tokens
												</dd>
											</div>
										) : null}
										{data.topProviders.length > 0 ? (
											<div>
												<dt className="text-muted-foreground">Top providers</dt>
												<dd className="font-medium">
													{data.topProviders
														.map(
															(provider) =>
																`${name(provider.providerId)} ${provider.sharePercent.toFixed(0)}%`,
														)
														.join(" · ")}
												</dd>
											</div>
										) : null}
										{data.topSources.length > 0 ? (
											<div>
												<dt className="text-muted-foreground">Top apps</dt>
												<dd className="font-medium">
													{data.topSources
														.map((source) => source.source)
														.join(" · ")}
												</dd>
											</div>
										) : null}
									</dl>
								</CardContent>
							</Card>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
