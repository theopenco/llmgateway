"use client";

import {
	ArrowUpRight,
	Loader2,
	PlaneTakeoff,
	Radar,
	Stamp,
} from "lucide-react";
import Link from "next/link";

import { useCompany } from "@/components/dashboard/company-context";
import { TrafficChart } from "@/components/dashboard/TrafficChart";
import { SlackCard } from "@/components/SlackCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { useApi } from "@/lib/fetch-client";
import { formatCompact, formatUsd } from "@/lib/format";

function StatCard({
	label,
	value,
	hint,
}: {
	label: string;
	value: string;
	hint?: string;
}) {
	return (
		<Card className="gap-2 py-4">
			<CardHeader className="gap-0">
				<CardDescription className="font-mono text-[0.65rem] tracking-[0.2em] uppercase">
					{label}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="font-display text-2xl font-black tracking-tight">
					{value}
				</div>
				{hint ? (
					<div className="text-muted-foreground mt-0.5 text-xs">{hint}</div>
				) : null}
			</CardContent>
		</Card>
	);
}

export default function OperationsPage() {
	const api = useApi();
	const { company, isLoading: companyLoading } = useCompany();

	const statsQuery = api.useQuery(
		"get",
		"/airside/stats",
		{
			params: {
				query: { providerCompanyId: company?.id ?? "", days: 30 },
			},
		},
		{ enabled: !!company },
	);
	const filingsQuery = api.useQuery(
		"get",
		"/airside/filings",
		{
			params: { query: { providerCompanyId: company?.id ?? "" } },
		},
		{ enabled: !!company },
	);

	if (companyLoading) {
		return (
			<div className="flex h-64 items-center justify-center">
				<Loader2 className="text-muted-foreground size-5 animate-spin" />
			</div>
		);
	}

	if (!company) {
		return (
			<div className="mx-auto max-w-md py-20 text-center">
				<Radar className="text-primary mx-auto mb-4 size-8" />
				<h1 className="font-display text-2xl font-black">
					No carrier registered yet
				</h1>
				<p className="text-muted-foreground mt-2 text-sm">
					Register your company and claim your carrier code to enter operations.
				</p>
				<Button asChild className="mt-6 font-semibold">
					<Link href="/onboarding">Start onboarding</Link>
				</Button>
			</div>
		);
	}

	const stats = statsQuery.data;
	const pendingFilings = (filingsQuery.data?.filings ?? []).filter(
		(f) => f.status === "pending",
	);

	return (
		<div className="space-y-6" data-testid="operations-page">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<p className="text-primary font-mono text-[0.65rem] tracking-[0.3em] uppercase">
						Operations · last 30 days
					</p>
					<h1 className="font-display text-3xl font-black tracking-tight">
						{company.name}
					</h1>
				</div>
				<div className="flex flex-wrap gap-2">
					{company.claims.map((claim) => (
						<Badge
							key={claim.id}
							variant={claim.status === "active" ? "outline" : "pending"}
						>
							<PlaneTakeoff className="size-3" />
							{claim.providerName}
							{claim.status === "pending" ? " · under review" : ""}
						</Badge>
					))}
				</div>
			</div>

			{company.claims.length > 0 &&
			company.claims.every((claim) => claim.status !== "active") ? (
				<div
					className="border-primary/40 bg-primary/10 rounded-lg border px-4 py-3 text-sm"
					data-testid="claim-review-notice"
				>
					Your carrier claim is with the regulator — we approve every new
					carrier before it goes live. We&apos;ll ping you in the shared Slack
					channel once you&apos;re cleared.
				</div>
			) : null}

			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<StatCard
					label="Requests"
					value={stats ? formatCompact(stats.totals.requestCount) : "—"}
					hint={
						stats
							? `${formatCompact(stats.totals.errorCount)} errors`
							: undefined
					}
				/>
				<StatCard
					label="Tokens out"
					value={stats ? formatCompact(stats.totals.outputTokens) : "—"}
					hint={
						stats ? `${formatCompact(stats.totals.inputTokens)} in` : undefined
					}
				/>
				<StatCard
					label="Billed traffic"
					value={stats ? formatUsd(stats.totals.cost) : "—"}
				/>
				<StatCard
					label="Est. payout"
					value={stats ? formatUsd(stats.totals.estimatedPayout) : "—"}
					hint="at current landing fee"
				/>
			</div>

			<Card>
				<CardHeader>
					<CardTitle className="font-display">Daily traffic</CardTitle>
					<CardDescription>
						Requests and billed traffic across your claimed carriers.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<TrafficChart daily={stats?.daily ?? []} />
				</CardContent>
			</Card>

			<div className="grid gap-4 lg:grid-cols-2">
				<Card>
					<CardHeader className="flex-row items-center justify-between">
						<div>
							<CardTitle className="font-display flex items-center gap-2">
								<Stamp className="text-primary size-4" /> Pending filings
							</CardTitle>
							<CardDescription>
								Tariffs waiting on regulator approval.
							</CardDescription>
						</div>
						<Button asChild variant="ghost" size="sm">
							<Link href="/dashboard/filings">
								All filings <ArrowUpRight className="size-3.5" />
							</Link>
						</Button>
					</CardHeader>
					<CardContent>
						{pendingFilings.length === 0 ? (
							<p className="text-muted-foreground text-sm">
								Nothing in the queue — your tariffs are all cleared.
							</p>
						) : (
							<ul className="space-y-2">
								{pendingFilings.slice(0, 4).map((filing) => (
									<li
										key={filing.id}
										className="border-border flex items-center justify-between rounded-md border px-3 py-2"
									>
										<span className="font-mono text-sm">
											{filing.modelName}
										</span>
										<Badge variant="pending">
											{filing.kind === "initial"
												? "New listing"
												: "Fare change"}
										</Badge>
									</li>
								))}
							</ul>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className="font-display">Top models</CardTitle>
						<CardDescription>By billed traffic, last 30 days.</CardDescription>
					</CardHeader>
					<CardContent>
						{!stats || stats.byModel.length === 0 ? (
							<p className="text-muted-foreground text-sm">
								No traffic yet — once dispatch routes passengers to your models,
								they land here.
							</p>
						) : (
							<ul className="space-y-2">
								{stats.byModel.slice(0, 4).map((row) => (
									<li
										key={`${row.providerId}/${row.model}`}
										className="flex items-center justify-between text-sm"
									>
										<span className="font-mono">{row.model}</span>
										<span className="text-muted-foreground">
											{formatCompact(row.requestCount)} req ·{" "}
											{formatUsd(row.cost)}
										</span>
									</li>
								))}
							</ul>
						)}
					</CardContent>
				</Card>
			</div>

			<SlackCard />
		</div>
	);
}
