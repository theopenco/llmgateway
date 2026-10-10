"use client";

import { format, subMinutes } from "date-fns";
import { AlertTriangle, Eye, ShieldAlert, ShieldCheck } from "lucide-react";
import { useState } from "react";

import {
	VIOLATIONS,
	VIOLATION_STATS,
} from "@/components/home/dashboard-demo-data";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";

import { useDemo } from "./context";

function actionVariant(
	action: string,
): "destructive" | "secondary" | "outline" {
	if (action === "blocked") {
		return "destructive";
	}
	if (action === "redacted") {
		return "secondary";
	}
	return "outline";
}

function ActionIcon({ action }: { action: string }) {
	if (action === "blocked") {
		return <ShieldAlert className="h-4 w-4" />;
	}
	if (action === "redacted") {
		return <Eye className="h-4 w-4" />;
	}
	return <AlertTriangle className="h-4 w-4" />;
}

export function SecurityEventsView() {
	const { openedAt, notify, track } = useDemo();
	const [actionFilter, setActionFilter] = useState("all");
	const [categoryFilter, setCategoryFilter] = useState("all");
	const [statsDays, setStatsDays] = useState<"7" | "30" | "90">("7");
	const stats = VIOLATION_STATS[statsDays];

	const violations = VIOLATIONS.filter(
		(violation) =>
			(actionFilter === "all" || violation.actionTaken === actionFilter) &&
			(categoryFilter === "all" || violation.category === categoryFilter),
	).map((violation) => ({
		...violation,
		createdAt: format(subMinutes(openedAt, violation.agoMinutes), "PPp"),
	}));

	return (
		<div className="space-y-6">
			<div className="space-y-4">
				<div className="flex items-center justify-between gap-2">
					<h2 className="text-lg font-semibold">Overview</h2>
					<Select
						value={statsDays}
						onValueChange={(value) => {
							setStatsDays(value as "7" | "30" | "90");
							track("security_stats_days", value);
						}}
					>
						<SelectTrigger className="w-[160px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="7">Last 7 days</SelectItem>
							<SelectItem value="30">Last 30 days</SelectItem>
							<SelectItem value="90">Last 90 days</SelectItem>
						</SelectContent>
					</Select>
				</div>
				<div className="grid gap-4 md:grid-cols-4">
					<Card>
						<CardHeader className="pb-2">
							<CardDescription>Total Violations</CardDescription>
							<CardTitle className="text-3xl">{stats.total}</CardTitle>
							<p className="text-xs text-muted-foreground">
								Last {statsDays} days
							</p>
						</CardHeader>
					</Card>
					<Card>
						<CardHeader className="pb-2">
							<CardDescription>Last 24 Hours</CardDescription>
							<CardTitle className="text-3xl">{stats.last24Hours}</CardTitle>
							<p className="text-xs text-muted-foreground">&nbsp;</p>
						</CardHeader>
					</Card>
					<Card>
						<CardHeader className="pb-2">
							<CardDescription>Blocked</CardDescription>
							<CardTitle className="text-3xl text-destructive">
								{stats.blocked}
							</CardTitle>
							<p className="text-xs text-muted-foreground">
								Last {statsDays} days
							</p>
						</CardHeader>
					</Card>
					<Card>
						<CardHeader className="pb-2">
							<CardDescription>Redacted</CardDescription>
							<CardTitle className="text-3xl text-orange-500">
								{stats.redacted}
							</CardTitle>
							<p className="text-xs text-muted-foreground">
								Last {statsDays} days
							</p>
						</CardHeader>
					</Card>
				</div>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Security Events</CardTitle>
					<CardDescription>
						View all guardrail violations and security events
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="mb-6 flex flex-wrap gap-4">
						<div className="flex items-center gap-2">
							<span className="text-sm font-medium text-muted-foreground">
								Action:
							</span>
							<Select
								value={actionFilter}
								onValueChange={(value) => {
									setActionFilter(value);
									track("security_filter", `action:${value}`);
								}}
							>
								<SelectTrigger className="w-[140px]">
									<SelectValue placeholder="All actions" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All actions</SelectItem>
									<SelectItem value="blocked">Blocked</SelectItem>
									<SelectItem value="redacted">Redacted</SelectItem>
									<SelectItem value="warned">Warned</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="flex items-center gap-2">
							<span className="text-sm font-medium text-muted-foreground">
								Category:
							</span>
							<Select
								value={categoryFilter}
								onValueChange={(value) => {
									setCategoryFilter(value);
									track("security_filter", `category:${value}`);
								}}
							>
								<SelectTrigger className="w-[180px]">
									<SelectValue placeholder="All categories" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All categories</SelectItem>
									<SelectItem value="injection">Prompt Injection</SelectItem>
									<SelectItem value="jailbreak">Jailbreak</SelectItem>
									<SelectItem value="pii">PII Detection</SelectItem>
									<SelectItem value="secrets">Secrets</SelectItem>
									<SelectItem value="files">File Types</SelectItem>
									<SelectItem value="document_leakage">
										Document Leakage
									</SelectItem>
									<SelectItem value="blocked_terms">Blocked Terms</SelectItem>
									<SelectItem value="custom_regex">Custom Regex</SelectItem>
									<SelectItem value="topic_restriction">
										Topic Restriction
									</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>

					<div className="space-y-4 @3xl/demo:hidden">
						{violations.map((violation) => (
							<Card key={violation.id}>
								<CardContent className="pt-4">
									<div className="flex flex-col gap-2">
										<div className="flex items-center justify-between gap-2">
											<Badge
												variant={actionVariant(violation.actionTaken)}
												className="flex items-center gap-1"
											>
												<ActionIcon action={violation.actionTaken} />
												{violation.actionTaken}
											</Badge>
											<span className="text-xs text-muted-foreground">
												{violation.createdAt}
											</span>
										</div>
										<div className="text-sm font-medium">
											{violation.ruleName}
										</div>
										<div className="flex items-center gap-2 text-sm text-muted-foreground">
											<Badge variant="outline" className="text-xs">
												{violation.category}
											</Badge>
										</div>
										{violation.matchedPattern && (
											<div className="truncate text-xs text-muted-foreground">
												Pattern: {violation.matchedPattern}
											</div>
										)}
									</div>
								</CardContent>
							</Card>
						))}
					</div>

					<div className="hidden overflow-hidden rounded-md border @3xl/demo:block">
						<table className="w-full">
							<thead className="bg-muted/50">
								<tr>
									{["Timestamp", "Rule", "Category", "Action", "Details"].map(
										(heading) => (
											<th
												key={heading}
												className="p-4 text-left text-sm font-medium text-muted-foreground"
											>
												{heading}
											</th>
										),
									)}
								</tr>
							</thead>
							<tbody className="divide-y">
								{violations.map((violation) => (
									<tr
										key={violation.id}
										className="transition-colors hover:bg-muted/25"
									>
										<td className="whitespace-nowrap p-4 align-middle text-sm">
											{violation.createdAt}
										</td>
										<td className="p-4 align-middle">
											<span className="text-sm font-medium">
												{violation.ruleName}
											</span>
										</td>
										<td className="whitespace-nowrap p-4 align-middle">
											<Badge variant="outline" className="text-xs">
												{violation.category}
											</Badge>
										</td>
										<td className="p-4 align-middle">
											<Badge
												variant={actionVariant(violation.actionTaken)}
												className="flex w-fit items-center gap-1"
											>
												<ActionIcon action={violation.actionTaken} />
												{violation.actionTaken}
											</Badge>
										</td>
										<td className="max-w-xs truncate p-4 align-middle text-sm text-muted-foreground">
											{violation.matchedPattern ?? "—"}
										</td>
									</tr>
								))}
								{violations.length === 0 && (
									<tr>
										<td
											colSpan={5}
											className="p-8 text-center text-muted-foreground"
										>
											<div className="flex flex-col items-center gap-2">
												<ShieldCheck className="h-12 w-12 text-muted-foreground/50" />
												<span>No security events found</span>
											</div>
										</td>
									</tr>
								)}
							</tbody>
						</table>
					</div>
					<div className="flex justify-center pt-4">
						<Button
							variant="outline"
							onClick={() =>
								notify("Sample data ends here. Your own events keep going.")
							}
						>
							Load More
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
