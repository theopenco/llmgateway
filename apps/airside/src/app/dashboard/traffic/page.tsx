"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useCompany } from "@/components/dashboard/company-context";
import { TrafficChart } from "@/components/dashboard/TrafficChart";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useApi } from "@/lib/fetch-client";
import { formatCompact, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

const WINDOWS = [7, 30, 90] as const;

export default function TrafficPage() {
	const api = useApi();
	const { company, isLoading: companyLoading } = useCompany();
	const [days, setDays] = useState<(typeof WINDOWS)[number]>(30);
	const [providerId, setProviderId] = useState<string | undefined>(undefined);

	const companyId = company?.id;
	useEffect(() => {
		// The provider filter belongs to one company's claims; switching
		// companies in the shell must not carry it over.
		setProviderId(undefined);
	}, [companyId]);

	const statsQuery = api.useQuery(
		"get",
		"/airside/stats",
		{
			params: {
				query: {
					providerCompanyId: company?.id ?? "",
					days,
					...(providerId ? { providerId } : {}),
				},
			},
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
			<p className="text-muted-foreground py-20 text-center text-sm">
				Register your company first —{" "}
				<Link href="/onboarding" className="text-primary hover:underline">
					start onboarding
				</Link>
				.
			</p>
		);
	}

	const stats = statsQuery.data;

	return (
		<div className="space-y-6" data-testid="traffic-page">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<p className="text-primary font-mono text-[0.65rem] tracking-[0.3em] uppercase">
						Traffic control
					</p>
					<h1 className="font-display text-3xl font-black tracking-tight">
						Route activity
					</h1>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<div className="border-border flex rounded-md border p-0.5">
						{WINDOWS.map((window) => (
							<button
								key={window}
								type="button"
								onClick={() => setDays(window)}
								className={cn(
									"rounded px-2.5 py-1 font-mono text-xs",
									days === window
										? "bg-primary/15 text-primary"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								{window}d
							</button>
						))}
					</div>
					{company.claims.length > 1 ? (
						<div className="border-border flex rounded-md border p-0.5">
							<button
								type="button"
								onClick={() => setProviderId(undefined)}
								className={cn(
									"rounded px-2.5 py-1 font-mono text-xs",
									!providerId
										? "bg-primary/15 text-primary"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								All carriers
							</button>
							{company.claims.map((claim) => (
								<button
									key={claim.providerId}
									type="button"
									onClick={() => setProviderId(claim.providerId)}
									className={cn(
										"rounded px-2.5 py-1 font-mono text-xs",
										providerId === claim.providerId
											? "bg-primary/15 text-primary"
											: "text-muted-foreground hover:text-foreground",
									)}
								>
									{claim.providerId}
								</button>
							))}
						</div>
					) : null}
				</div>
			</div>

			<Card>
				<CardHeader>
					<CardTitle className="font-display">Daily requests</CardTitle>
					<CardDescription>
						{stats
							? `${formatCompact(stats.totals.requestCount)} requests · ${formatUsd(stats.totals.cost)} billed · est. payout ${formatUsd(stats.totals.estimatedPayout)}`
							: "Loading…"}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<TrafficChart daily={stats?.daily ?? []} />
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle className="font-display">By model</CardTitle>
					<CardDescription>
						Where your passengers actually boarded.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{!stats || stats.byModel.length === 0 ? (
						<p className="text-muted-foreground text-sm">
							No traffic in this window.
						</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Model</TableHead>
									<TableHead>Carrier</TableHead>
									<TableHead className="text-right">Requests</TableHead>
									<TableHead className="text-right">Errors</TableHead>
									<TableHead className="text-right">Tokens out</TableHead>
									<TableHead className="text-right">Billed</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{stats.byModel.map((row) => (
									<TableRow key={`${row.providerId}/${row.model}`}>
										<TableCell className="font-mono">{row.model}</TableCell>
										<TableCell className="text-muted-foreground font-mono">
											{row.providerId}
										</TableCell>
										<TableCell className="text-right font-mono">
											{formatCompact(row.requestCount)}
										</TableCell>
										<TableCell className="text-right font-mono">
											{formatCompact(row.errorCount)}
										</TableCell>
										<TableCell className="text-right font-mono">
											{formatCompact(row.outputTokens)}
										</TableCell>
										<TableCell className="text-right font-mono">
											{formatUsd(row.cost)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			<div className="flex justify-end">
				<Button asChild variant="ghost" size="sm">
					<Link href="/dashboard/fares">
						Want more traffic? Tune your fares →
					</Link>
				</Button>
			</div>
		</div>
	);
}
