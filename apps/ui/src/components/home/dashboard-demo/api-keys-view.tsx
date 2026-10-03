"use client";

import { addDays, format, parseISO, subDays } from "date-fns";
import { AlertTriangleIcon, MoreHorizontal, Orbit } from "lucide-react";
import { useState } from "react";

import { formatCurrencyAmount } from "@/components/api-keys/api-key-limit-fields";
import {
	ApiKeyLimitMeter,
	apiKeyLimitTextTone,
} from "@/components/api-keys/api-key-limit-indicators";
import {
	DEMO_API_KEYS,
	DEMO_API_KEY_DETAILS,
	DEMO_USER_NAMES,
	sliceHistory,
	type DemoApiKeyDetail,
} from "@/components/home/dashboard-demo-data";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import { Card, CardContent } from "@/lib/components/card";
import { StatusBadge } from "@/lib/components/status-badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/lib/components/table";
import { Tabs, TabsList, TabsTrigger } from "@/lib/components/tabs";
import { cn } from "@/lib/utils";

import { READ_ONLY_MESSAGE, useDemo } from "./context";

import type {
	ApiKeyLimitGauge,
	ApiKeyLimitState,
} from "@/components/api-keys/api-key-limit-status";
import type { DailyActivity } from "@/types/activity";

type StatusFilter = "all" | "active" | "inactive";

function gauge(usage: number, limit: number | null): ApiKeyLimitGauge | null {
	if (!limit) {
		return null;
	}
	const ratio = usage / limit;
	const state: ApiKeyLimitState =
		ratio >= 1 ? "reached" : ratio >= 0.8 ? "approaching" : "ok";
	return { limit, ratio, state, usage };
}

function keyCost(history: DailyActivity[], keyId: string) {
	return history.reduce(
		(sum, day) =>
			sum + (day.apiKeyBreakdown.find((row) => row.id === keyId)?.cost ?? 0),
		0,
	);
}

interface KeyRow extends DemoApiKeyDetail {
	description: string;
	usage: number;
	periodUsage: number;
	total: ApiKeyLimitGauge | null;
	period: ApiKeyLimitGauge | null;
	resetsOn: Date | null;
}

export function ApiKeysView() {
	const { anchorDay, history, notify, track } = useDemo();
	const [creator, setCreator] = useState<"all" | "mine">("all");
	const [status, setStatus] = useState<StatusFilter>("all");
	const anchor = parseISO(anchorDay);

	const rows: KeyRow[] = DEMO_API_KEY_DETAILS.map((detail) => {
		const description =
			detail.retired?.description ??
			DEMO_API_KEYS.find((key) => key.id === detail.id)?.description ??
			detail.id;
		const created = subDays(anchor, detail.createdDaysAgo);
		const usage =
			detail.retired?.usage ??
			keyCost(sliceHistory(history, created, anchor), detail.id);
		const periodDays = detail.periodLimit?.days ?? 0;
		const periodStart = subDays(
			anchor,
			periodDays ? detail.createdDaysAgo % periodDays : 0,
		);
		const periodUsage = detail.periodLimit
			? keyCost(sliceHistory(history, periodStart, anchor), detail.id)
			: 0;
		return {
			...detail,
			description,
			usage,
			periodUsage,
			total: gauge(usage, detail.usageLimit),
			period: gauge(periodUsage, detail.periodLimit?.amount ?? null),
			resetsOn: detail.periodLimit
				? addDays(periodStart, detail.periodLimit.days)
				: null,
		};
	});

	const creatorRows = rows.filter(
		(row) => creator === "all" || row.creatorId === "usr_maya",
	);
	const visible = creatorRows.filter(
		(row) => status === "all" || row.status === status,
	);
	const activeCount = creatorRows.filter(
		(row) => row.status === "active",
	).length;
	const counts: Record<StatusFilter, number> = {
		all: creatorRows.length,
		active: activeCount,
		inactive: creatorRows.length - activeCount,
	};

	return (
		<div className="flex flex-col">
			<div className="flex flex-col space-y-4 p-4 pt-6 md:p-8">
				<div className="flex flex-col gap-4 @3xl/demo:flex-row @3xl/demo:items-center @3xl/demo:justify-between">
					<div>
						<h2 className="text-3xl font-bold tracking-tight">API Keys</h2>
						<p className="text-muted-foreground">
							Create and manage API keys to authenticate requests to LLM Gateway
						</p>
					</div>
					<Button
						onClick={() => notify(READ_ONLY_MESSAGE)}
						className="flex w-full cursor-pointer items-center space-x-1 @3xl/demo:w-auto"
					>
						<Orbit className="mt-0.5 h-4 w-4" />
						Create API Key
					</Button>
				</div>
				<Card className="gap-0">
					<CardContent className="pt-6">
						<div className="mb-6 flex flex-col gap-4">
							<Tabs
								value={creator}
								onValueChange={(value) => {
									setCreator(value as "all" | "mine");
									track("api_keys_creator", value);
								}}
							>
								<TabsList className="flex w-full space-x-2 @3xl/demo:w-fit">
									<TabsTrigger value="all">All Keys</TabsTrigger>
									<TabsTrigger value="mine">My Keys</TabsTrigger>
								</TabsList>
							</Tabs>
							<Tabs
								value={status}
								onValueChange={(value) => {
									setStatus(value as StatusFilter);
									track("api_keys_status", value);
								}}
							>
								<TabsList className="flex w-full space-x-2 @3xl/demo:w-fit">
									{(["all", "active", "inactive"] as const).map((value) => (
										<TabsTrigger
											key={value}
											value={value}
											className="capitalize"
										>
											{value}{" "}
											<Badge
												variant={status === value ? "default" : "outline"}
												className="text-xs"
											>
												{counts[value]}
											</Badge>
										</TabsTrigger>
									))}
								</TabsList>
							</Tabs>
						</div>
						<div className="mb-4 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
							<span className="font-medium">API Keys:</span> {rows.length} of
							100 used
						</div>
						<div className="relative">
							<div className="overflow-x-auto">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Name</TableHead>
											<TableHead className="w-40">API Key</TableHead>
											<TableHead>Status</TableHead>
											<TableHead>Created</TableHead>
											<TableHead>Created By</TableHead>
											<TableHead>Usage</TableHead>
											<TableHead>Current Period</TableHead>
											<TableHead>Limits</TableHead>
											<TableHead>IAM Rules</TableHead>
											<TableHead className="w-12" />
										</TableRow>
									</TableHeader>
									<TableBody>
										{visible.map((row) => (
											<TableRow
												key={row.id}
												className="transition-colors hover:bg-muted/30"
											>
												<TableCell className="text-sm font-medium">
													{row.description}
												</TableCell>
												<TableCell className="min-w-40 max-w-40">
													<span className="truncate font-mono text-xs">
														{row.maskedToken}
													</span>
												</TableCell>
												<TableCell>
													<div className="space-y-1">
														<StatusBadge
															status={row.status}
															variant="detailed"
														/>
														{[row.total, row.period].some(
															(limit) => limit && limit.state !== "ok",
														) && (
															<Badge
																variant="secondary"
																className="flex w-fit items-center gap-1 border-amber-600/50 bg-amber-500/10 px-1 py-[2px] text-xs font-medium text-amber-600 dark:border-amber-500/50 dark:text-amber-500"
															>
																<AlertTriangleIcon className="h-3.5 w-3.5" />
																Near limit
															</Badge>
														)}
														{row.expiresInDays !== null && (
															<div className="text-xs text-muted-foreground">
																Expires{" "}
																{format(
																	addDays(anchor, row.expiresInDays),
																	"MMM d, yyyy",
																)}
															</div>
														)}
													</div>
												</TableCell>
												<TableCell className="whitespace-nowrap text-muted-foreground">
													{format(
														subDays(anchor, row.createdDaysAgo),
														"MMM d, yyyy",
													)}
												</TableCell>
												<TableCell className="whitespace-nowrap text-muted-foreground">
													{DEMO_USER_NAMES[row.creatorId] ?? "Unknown"}
												</TableCell>
												<TableCell>
													<div className="space-y-1">
														<div
															className={cn(
																"font-mono text-xs",
																row.total &&
																	apiKeyLimitTextTone[row.total.state],
															)}
														>
															{formatCurrencyAmount(row.usage)}
															{row.total
																? ` / ${formatCurrencyAmount(row.total.limit)}`
																: ""}
														</div>
														{row.total && (
															<ApiKeyLimitMeter gauge={row.total} />
														)}
													</div>
												</TableCell>
												<TableCell>
													{row.period && row.periodLimit && row.resetsOn ? (
														<div className="space-y-1">
															<div
																className={cn(
																	"font-mono text-xs",
																	apiKeyLimitTextTone[row.period.state],
																)}
															>
																{formatCurrencyAmount(row.periodUsage)} /{" "}
																{formatCurrencyAmount(row.period.limit)}
															</div>
															<ApiKeyLimitMeter gauge={row.period} />
															<div className="text-xs text-muted-foreground">
																Every {row.periodLimit.days} days
															</div>
															<div className="text-xs text-muted-foreground">
																Resets {format(row.resetsOn, "MMM d")}
															</div>
														</div>
													) : (
														<span className="text-xs text-muted-foreground">
															No period limit
														</span>
													)}
												</TableCell>
												<TableCell>
													<Button
														variant="outline"
														size="sm"
														onClick={() => notify(READ_ONLY_MESSAGE)}
														className="flex min-w-48 items-center justify-between gap-3"
													>
														<div className="text-left">
															<div className="font-mono text-xs">
																{row.usageLimit
																	? formatCurrencyAmount(row.usageLimit)
																	: "No all-time limit"}
															</div>
															<div className="text-xs text-muted-foreground">
																{row.periodLimit
																	? `${formatCurrencyAmount(row.periodLimit.amount)} every ${row.periodLimit.days} days`
																	: "No period limit"}
															</div>
														</div>
													</Button>
												</TableCell>
												<TableCell>
													<Button
														variant={row.iamRules > 0 ? "outline" : "ghost"}
														size="sm"
														className={cn(
															"text-xs",
															row.iamRules === 0 && "text-muted-foreground",
														)}
														onClick={() => notify(READ_ONLY_MESSAGE)}
													>
														{row.iamRules > 0
															? `${row.iamRules} rule${row.iamRules !== 1 ? "s" : ""}`
															: "No rules"}
													</Button>
												</TableCell>
												<TableCell className="text-center">
													<Button
														variant="ghost"
														className="h-8 w-8 p-0"
														onClick={() => notify(READ_ONLY_MESSAGE)}
													>
														<span className="sr-only">Open menu</span>
														<MoreHorizontal className="h-4 w-4" />
													</Button>
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
							<div
								aria-hidden
								className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-card to-transparent"
							/>
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
