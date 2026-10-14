import { format } from "date-fns";
import { ShieldAlert } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
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
import {
	getContentFilterErrors,
	type ContentFilterErrorKind,
} from "@/lib/admin-content-filter";
import { ERROR_KIND_LABELS } from "@/lib/content-filter-errors";

import { formatNumber } from "@llmgateway/shared/number-format";

import { ContentFilterErrorsChart } from "./errors-chart";

import type { ContentFilterViolationsWindow } from "@/lib/content-filter-ranking";

const WINDOWS: { value: ContentFilterViolationsWindow; label: string }[] = [
	{ value: "24h", label: "24 hours" },
	{ value: "7d", label: "7 days" },
	{ value: "30d", label: "30 days" },
];

const KINDS = Object.keys(ERROR_KIND_LABELS) as ContentFilterErrorKind[];

// The org page shares one window param across its charts; map ours onto it.
const ORG_PAGE_WINDOW: Record<ContentFilterViolationsWindow, string> = {
	"24h": "1d",
	"7d": "7d",
	"30d": "30d",
};

function parseWindow(value: string | undefined): ContentFilterViolationsWindow {
	return WINDOWS.some((w) => w.value === value)
		? (value as ContentFilterViolationsWindow)
		: "24h";
}

function parseKind(
	value: string | undefined,
): ContentFilterErrorKind | undefined {
	return KINDS.some((k) => k === value)
		? (value as ContentFilterErrorKind)
		: undefined;
}

function pageHref(
	window: ContentFilterViolationsWindow,
	kind: ContentFilterErrorKind | undefined,
): string {
	const params = new URLSearchParams({ window });
	if (kind) {
		params.set("kind", kind);
	}
	return `/content-filter/errors?${params.toString()}`;
}

function kindLabel(kind: string): string {
	return ERROR_KIND_LABELS[kind as ContentFilterErrorKind] ?? kind;
}

function kindVariant(kind: string): "outline" | "destructive" | "secondary" {
	if (kind === "upstream_4xx") {
		return "outline";
	}
	return kind === "timeout" || kind === "network" ? "secondary" : "destructive";
}

function formatSeen(value: string): string {
	return value ? format(new Date(value), "MMM d HH:mm") : "—";
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

export default async function ContentFilterErrorsPage({
	searchParams,
}: {
	searchParams?: Promise<{ window?: string; kind?: string }>;
}) {
	const params = await searchParams;
	const window = parseWindow(params?.window);
	const kind = parseKind(params?.kind);
	const errors = await getContentFilterErrors(window, kind);

	if (errors === null) {
		return <SignInPrompt />;
	}

	return (
		<div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 md:px-8">
			<header className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-3">
					<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
						<ShieldAlert className="h-5 w-5" />
					</div>
					<div>
						<h1 className="text-2xl font-semibold tracking-tight">
							Moderation Errors
						</h1>
						<p className="text-sm text-muted-foreground">
							Classifier calls that failed and failed open, from the hourly
							rollup
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
							<CardTitle>Errors over time</CardTitle>
							<CardDescription>
								Rejected input (4xx) is the request&apos;s fault — an image
								format the classifier does not take, a corrupt upload — and is
								logged as a warning. Everything else is the classifier or the
								network failing.
							</CardDescription>
						</div>
						<div className="flex flex-col items-end gap-2">
							<div className="flex flex-wrap items-center gap-1">
								{WINDOWS.map((option) => (
									<Button
										key={option.value}
										asChild
										variant={window === option.value ? "default" : "outline"}
										size="sm"
									>
										<Link href={pageHref(option.value, kind)}>
											{option.label}
										</Link>
									</Button>
								))}
							</div>
							<div className="flex flex-wrap items-center justify-end gap-1">
								<Button
									asChild
									variant={kind === undefined ? "default" : "outline"}
									size="sm"
								>
									<Link href={pageHref(window, undefined)}>All kinds</Link>
								</Button>
								{KINDS.map((option) => (
									<Button
										key={option}
										asChild
										variant={kind === option ? "default" : "outline"}
										size="sm"
									>
										<Link href={pageHref(window, option)}>
											{ERROR_KIND_LABELS[option]}
										</Link>
									</Button>
								))}
							</div>
						</div>
					</div>
				</CardHeader>
				<CardContent>
					<div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
						<div>
							<span className="text-muted-foreground">Errors</span>
							<p className="text-xl font-semibold tabular-nums">
								{formatNumber(errors.totals.errorCount)}
							</p>
						</div>
						{errors.totals.bySource.map((entry) => (
							<div key={entry.source}>
								<span className="text-muted-foreground">{entry.source}</span>
								<p className="text-xl font-semibold tabular-nums">
									{formatNumber(entry.errorCount)}
								</p>
							</div>
						))}
						{errors.totals.byKind.length > 0 ? (
							<div className="flex flex-wrap items-center gap-1.5">
								{errors.totals.byKind.map((entry) => (
									<Badge key={entry.kind} variant={kindVariant(entry.kind)}>
										{kindLabel(entry.kind)} ({formatNumber(entry.errorCount)})
									</Badge>
								))}
							</div>
						) : null}
					</div>
					{errors.totals.errorCount === 0 ? (
						<div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
							No failed moderation calls in this window
						</div>
					) : (
						<ContentFilterErrorsChart
							bucketTimestamps={errors.bucketTimestamps}
							series={errors.series}
							hourly={window === "24h"}
						/>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Failure shapes</CardTitle>
					<CardDescription>
						Distinct (classifier, kind, status, code) combinations with the
						latest message seen for each. Source is the classifier whose call
						failed; it differs from the deciding classifier when a text-only
						classifier delegated an image to OpenAI.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{errors.buckets.length === 0 ? (
						<p className="text-sm text-muted-foreground">Nothing to show.</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Kind</TableHead>
									<TableHead>Source</TableHead>
									<TableHead>Classifier</TableHead>
									<TableHead>Input</TableHead>
									<TableHead>Status</TableHead>
									<TableHead>Code</TableHead>
									<TableHead>Last message</TableHead>
									<TableHead className="text-right">Count</TableHead>
									<TableHead>Last seen</TableHead>
									<TableHead>Last request</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{errors.buckets.map((bucket) => (
									<TableRow
										key={`${bucket.classifier}/${bucket.source}/${bucket.kind}/${bucket.inputType}/${bucket.status}/${bucket.code}`}
									>
										<TableCell>
											<Badge variant={kindVariant(bucket.kind)}>
												{kindLabel(bucket.kind)}
											</Badge>
										</TableCell>
										<TableCell>{bucket.source}</TableCell>
										<TableCell>{bucket.classifier}</TableCell>
										<TableCell>{bucket.inputType || "—"}</TableCell>
										<TableCell className="tabular-nums">
											{bucket.status || "—"}
										</TableCell>
										<TableCell className="font-mono text-xs">
											{bucket.code || "—"}
										</TableCell>
										<TableCell className="max-w-md truncate text-xs text-muted-foreground">
											{bucket.lastMessage || "—"}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatNumber(bucket.errorCount)}
										</TableCell>
										<TableCell className="whitespace-nowrap text-xs">
											{formatSeen(bucket.lastSeenAt)}
										</TableCell>
										<TableCell className="font-mono text-xs">
											{bucket.lastRequestId || "—"}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Organizations</CardTitle>
					<CardDescription>
						Who the failed calls belong to. A single organization dominating the
						4xx bucket is usually one client sending an unsupported image
						format.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{errors.organizations.length === 0 ? (
						<p className="text-sm text-muted-foreground">Nothing to show.</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Organization</TableHead>
									<TableHead>Plan</TableHead>
									<TableHead>Top kind</TableHead>
									<TableHead className="text-right">Errors</TableHead>
									<TableHead>Last seen</TableHead>
									<TableHead>Last request</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{errors.organizations.map((org) => (
									<TableRow key={org.organizationId}>
										<TableCell>
											<Link
												href={`/organizations/${org.organizationId}?window=${ORG_PAGE_WINDOW[window]}#content-filter`}
												className="hover:underline"
											>
												{org.organizationName ?? org.organizationId}
											</Link>
										</TableCell>
										<TableCell>{org.plan ?? "—"}</TableCell>
										<TableCell>
											<Badge variant={kindVariant(org.topKind)}>
												{kindLabel(org.topKind)}
											</Badge>
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatNumber(org.errorCount)}
										</TableCell>
										<TableCell className="whitespace-nowrap text-xs">
											{formatSeen(org.lastSeenAt)}
										</TableCell>
										<TableCell className="font-mono text-xs">
											{org.lastRequestId || "—"}
										</TableCell>
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
