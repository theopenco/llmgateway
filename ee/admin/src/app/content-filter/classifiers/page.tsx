import { Scale } from "lucide-react";
import Link from "next/link";

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
import { getContentFilterClassifiers } from "@/lib/admin-content-filter";
import {
	classifierLabel,
	classifierSeriesKey,
} from "@/lib/content-filter-classifiers";

import { formatNumber } from "@llmgateway/shared/number-format";

import { ClassifierRateChart } from "./rate-chart";

import type { ContentFilterViolationsWindow } from "@/lib/content-filter-ranking";

const WINDOWS: { value: ContentFilterViolationsWindow; label: string }[] = [
	{ value: "24h", label: "24 hours" },
	{ value: "7d", label: "7 days" },
	{ value: "30d", label: "30 days" },
];

const percentFormatter = new Intl.NumberFormat("en-US", {
	style: "percent",
	maximumFractionDigits: 2,
});

function parseWindow(value: string | undefined): ContentFilterViolationsWindow {
	return WINDOWS.some((w) => w.value === value)
		? (value as ContentFilterViolationsWindow)
		: "7d";
}

function rate(numerator: number, denominator: number): string {
	return denominator > 0
		? percentFormatter.format(numerator / denominator)
		: "—";
}

function SignInPrompt() {
	return (
		<div className="flex min-h-screen items-center justify-center px-4">
			<div className="w-full max-w-md text-center">
				<h1 className="text-3xl font-semibold tracking-tight">
					Admin Dashboard
				</h1>
				<p className="mt-2 text-sm text-muted-foreground">
					Sign in to access the admin dashboard
				</p>
				<Button asChild size="lg" className="mt-8 w-full">
					<Link href="/login">Sign In</Link>
				</Button>
			</div>
		</div>
	);
}

export default async function ContentFilterClassifiersPage({
	searchParams,
}: {
	searchParams?: Promise<{ window?: string }>;
}) {
	const params = await searchParams;
	const window = parseWindow(params?.window);
	const data = await getContentFilterClassifiers(window);

	if (data === null) {
		return <SignInPrompt />;
	}

	const sampledByKey = new Map(
		data.classifiers.map((row) => [classifierSeriesKey(row), row.sampledCount]),
	);
	const categoryNames = Array.from(
		new Set(data.categories.map((row) => row.category)),
	);
	const categoryCounts = new Map(
		data.categories.map((row) => [
			`${classifierSeriesKey(row)}/${row.category}`,
			row.violationCount,
		]),
	);

	return (
		<div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 md:px-8">
			<header className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-3">
					<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
						<Scale className="h-5 w-5" />
					</div>
					<div>
						<h1 className="text-2xl font-semibold tracking-tight">
							Classifier Comparison
						</h1>
						<p className="text-sm text-muted-foreground">
							Flag rates per moderation classifier, deciding and shadow runs
							combined, from the hourly rollup
						</p>
					</div>
				</div>
				<Button asChild variant="outline" size="sm">
					<Link href={`/content-filter?window=${window}`}>
						Back to content filter
					</Link>
				</Button>
			</header>

			<Card>
				<CardHeader>
					<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
						<div>
							<CardTitle>Flag rate by classifier</CardTitle>
							<CardDescription>
								A classifier counts the same whether it decided or ran as a
								shadow, so its rate stays comparable across setups. While
								several run in parallel they score the same requests. Sampled
								leaves out checks whose moderation call failed; only the
								deciding classifier blocks.
							</CardDescription>
						</div>
						<div className="flex shrink-0 flex-wrap items-center gap-1">
							{WINDOWS.map((option) => (
								<Button
									key={option.value}
									asChild
									variant={window === option.value ? "default" : "outline"}
									size="sm"
								>
									<Link
										href={`/content-filter/classifiers?window=${option.value}`}
									>
										{option.label}
									</Link>
								</Button>
							))}
						</div>
					</div>
				</CardHeader>
				<CardContent>
					{data.classifiers.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							No moderated requests in this window.
						</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Classifier</TableHead>
									<TableHead className="text-right">Sampled</TableHead>
									<TableHead className="text-right">Flagged</TableHead>
									<TableHead className="text-right">Flag rate</TableHead>
									<TableHead className="text-right">Blocked</TableHead>
									<TableHead className="text-right">Decided</TableHead>
									<TableHead className="text-right">Shadowed</TableHead>
									<TableHead className="text-right">Avg duration</TableHead>
									<TableHead className="text-right">Organizations</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{data.classifiers.map((row) => (
									<TableRow key={classifierSeriesKey(row)}>
										<TableCell className="font-medium">
											{classifierLabel(row)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatNumber(row.sampledCount)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatNumber(row.violationCount)}
										</TableCell>
										<TableCell className="text-right font-semibold tabular-nums">
											{rate(row.violationCount, row.sampledCount)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatNumber(row.blockedCount)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatNumber(row.decidingSampledCount)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatNumber(row.shadowSampledCount)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{row.avgDurationMs === null
												? "—"
												: `${formatNumber(row.avgDurationMs)} ms`}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatNumber(row.organizationCount)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			{data.classifiers.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle>Flag rate over time</CardTitle>
						<CardDescription>
							Share of sampled requests each classifier flagged, per{" "}
							{window === "24h" ? "hour" : "day"}.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<ClassifierRateChart
							bucketTimestamps={data.bucketTimestamps}
							classifiers={data.classifiers}
							series={data.series}
							hourly={window === "24h"}
						/>
					</CardContent>
				</Card>
			)}

			<Card>
				<CardHeader>
					<CardTitle>Violation reasons</CardTitle>
					<CardDescription>
						Requests each classifier flagged per category, with the share of its
						sampled requests. Category names are each classifier&apos;s own, so
						only shared names line up across columns.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{categoryNames.length === 0 ? (
						<p className="text-sm text-muted-foreground">Nothing to show.</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Category</TableHead>
									{data.classifiers.map((row) => (
										<TableHead
											key={classifierSeriesKey(row)}
											className="text-right"
										>
											{classifierLabel(row)}
										</TableHead>
									))}
								</TableRow>
							</TableHeader>
							<TableBody>
								{categoryNames.map((category) => (
									<TableRow key={category}>
										<TableCell className="font-mono text-xs">
											{category}
										</TableCell>
										{data.classifiers.map((row) => {
											const key = classifierSeriesKey(row);
											const count = categoryCounts.get(`${key}/${category}`);
											return (
												<TableCell
													key={key}
													className="text-right tabular-nums"
												>
													{count === undefined
														? "—"
														: `${formatNumber(count)} (${rate(count, sampledByKey.get(key) ?? 0)})`}
												</TableCell>
											);
										})}
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
