import {
	AlertCircle,
	ArrowLeft,
	Building2,
	CreditCard,
	Receipt,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireSession } from "@/lib/require-session";
import { createServerApiClient } from "@/lib/server-api";
import { cn } from "@/lib/utils";

const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 2,
});

const currencyFormatterPrecise = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 4,
});

function formatDate(dateString: string | null) {
	if (!dateString) {
		return "—";
	}
	return new Date(dateString).toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

function formatDateTime(dateString: string) {
	return new Date(dateString).toLocaleString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function formatTransactionType(type: string) {
	return type.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function getTransactionTypeBadgeVariant(
	type: string,
): "default" | "secondary" | "outline" | "destructive" {
	if (type.includes("cancel") || type.includes("end")) {
		return "destructive";
	}
	if (type.includes("start") || type.includes("renewal")) {
		return "default";
	}
	if (type.includes("upgrade") || type.includes("downgrade")) {
		return "secondary";
	}
	return "outline";
}

function getTierBadgeVariant(
	tier: string,
): "default" | "secondary" | "outline" {
	switch (tier) {
		case "max":
			return "default";
		case "pro":
			return "secondary";
		case "lite":
			return "outline";
		default:
			return "outline";
	}
}

function getStatusBadgeVariant(
	status: string,
): "default" | "secondary" | "outline" | "destructive" {
	switch (status) {
		case "active":
			return "secondary";
		case "cancelled_pending":
			return "outline";
		case "expired":
			return "destructive";
		case "churned":
			return "outline";
		default:
			return "outline";
	}
}

function formatStatus(status: string) {
	if (status === "cancelled_pending") {
		return "cancel pending";
	}
	return status;
}

function SignInPrompt() {
	return (
		<div className="flex min-h-screen items-center justify-center px-4">
			<div className="w-full max-w-md text-center">
				<div className="mb-8">
					<h1 className="text-3xl font-semibold tracking-tight">
						Admin Dashboard
					</h1>
					<p className="mt-2 text-sm text-muted-foreground">
						Sign in to access the admin dashboard
					</p>
				</div>
				<Button asChild size="lg" className="w-full">
					<Link href="/login">Sign In</Link>
				</Button>
			</div>
		</div>
	);
}

export default async function DevpassDetailPage({
	params,
}: {
	params: Promise<{ orgId: string }>;
}) {
	await requireSession();

	const { orgId } = await params;

	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/devpass/{orgId}", {
		params: { path: { orgId } },
	});

	if (data === null) {
		return <SignInPrompt />;
	}

	if (!data) {
		notFound();
	}

	const sub = data.subscriber;
	const utilizationClamped =
		sub.utilizationPct === null
			? 0
			: Math.min(100, Math.max(0, sub.utilizationPct));
	const utilizationTone =
		sub.utilizationPct === null
			? "bg-muted"
			: sub.utilizationPct < 20
				? "bg-amber-500"
				: sub.utilizationPct > 100
					? "bg-rose-500"
					: sub.utilizationPct > 80
						? "bg-orange-500"
						: "bg-emerald-500";

	return (
		<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
			<div className="flex items-center gap-2">
				<Button variant="ghost" size="sm" asChild>
					<Link href="/devpass">
						<ArrowLeft className="h-4 w-4" />
						Back
					</Link>
				</Button>
			</div>

			<header className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-start">
				<div className="space-y-2">
					<div className="flex items-center gap-3">
						<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
							<Building2 className="h-5 w-5" />
						</div>
						<div>
							<h1 className="text-2xl font-semibold tracking-tight">
								{sub.name}
							</h1>
							<p className="text-sm text-muted-foreground">{sub.id}</p>
						</div>
					</div>
					<div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
						<span>{sub.ownerEmail ?? sub.billingEmail}</span>
						<span>•</span>
						<span>Subscribed {formatDate(sub.subscribedSince)}</span>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Badge variant={getTierBadgeVariant(sub.tier)}>
							Tier: {sub.tier}
						</Badge>
						<Badge variant={getStatusBadgeVariant(sub.status)}>
							{formatStatus(sub.status)}
						</Badge>
						{sub.hasPaymentIssue && (
							<Badge variant="destructive" className="gap-1">
								<AlertCircle className="h-3 w-3" />
								payment issue
							</Badge>
						)}
						{sub.allowAllModels && (
							<Badge variant="outline">all-models access</Badge>
						)}
					</div>
				</div>
				<Button variant="outline" size="sm" asChild>
					<Link href={`/organizations/${sub.id}`}>Open in Organizations</Link>
				</Button>
			</header>

			<section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
				<div className="rounded-lg border border-border/60 bg-card p-4">
					<div className="text-xs uppercase tracking-wide text-muted-foreground">
						Cycle utilization
					</div>
					<div className="mt-2 text-2xl font-semibold tabular-nums">
						{sub.utilizationPct === null
							? "—"
							: `${sub.utilizationPct.toFixed(1)}%`}
					</div>
					<div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
						<div
							className={cn("h-full", utilizationTone)}
							style={{ width: `${utilizationClamped}%` }}
						/>
					</div>
					<div className="mt-2 text-xs tabular-nums text-muted-foreground">
						{currencyFormatter.format(parseFloat(sub.creditsUsed))} of{" "}
						{currencyFormatter.format(parseFloat(sub.creditsLimit))}
					</div>
					<div className="mt-1 text-xs text-muted-foreground">
						{sub.cycleDaysIn !== null
							? `Day ${sub.cycleDaysIn} of cycle`
							: "No active cycle"}
					</div>
				</div>
				<div className="rounded-lg border border-border/60 bg-card p-4">
					<div className="text-xs uppercase tracking-wide text-muted-foreground">
						MRR
					</div>
					<div className="mt-2 text-2xl font-semibold tabular-nums">
						{currencyFormatter.format(sub.mrr)}
					</div>
					<div className="mt-1 text-xs text-muted-foreground">
						Renews {formatDate(sub.expiresAt)}
					</div>
				</div>
				<div className="rounded-lg border border-border/60 bg-card p-4">
					<div className="text-xs uppercase tracking-wide text-muted-foreground">
						Real provider cost (cycle)
					</div>
					<div className="mt-2 text-2xl font-semibold tabular-nums">
						{currencyFormatterPrecise.format(sub.realCost)}
					</div>
					<div className="mt-1 text-xs text-muted-foreground">
						From hourly project stats
					</div>
				</div>
				<div className="rounded-lg border border-border/60 bg-card p-4">
					<div className="text-xs uppercase tracking-wide text-muted-foreground">
						Margin
					</div>
					<div
						className={cn(
							"mt-2 text-2xl font-semibold tabular-nums",
							sub.margin < 0
								? "text-rose-600 dark:text-rose-400"
								: "text-emerald-600 dark:text-emerald-400",
						)}
					>
						{currencyFormatter.format(sub.margin)}
					</div>
					<div className="mt-1 text-xs text-muted-foreground">
						{sub.tierChanges} tier change
						{sub.tierChanges === 1 ? "" : "s"} all time
					</div>
				</div>
			</section>

			<Tabs defaultValue="transactions">
				<TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
					<TabsTrigger value="transactions">
						<Receipt className="mr-1.5 h-4 w-4" />
						Subscription history ({data.transactions.length})
					</TabsTrigger>
					<TabsTrigger value="payment-failures">
						<CreditCard className="mr-1.5 h-4 w-4" />
						Payment failures ({data.paymentFailures.length})
					</TabsTrigger>
				</TabsList>

				<TabsContent value="transactions">
					<div className="overflow-x-auto rounded-lg border border-border/60 bg-card">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Date</TableHead>
									<TableHead>Event</TableHead>
									<TableHead>Amount</TableHead>
									<TableHead>Credits</TableHead>
									<TableHead>Status</TableHead>
									<TableHead>Description</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{data.transactions.length === 0 ? (
									<TableRow>
										<TableCell
											colSpan={6}
											className="h-24 text-center text-muted-foreground"
										>
											No subscription events recorded
										</TableCell>
									</TableRow>
								) : (
									data.transactions.map((t) => (
										<TableRow key={t.id}>
											<TableCell className="text-muted-foreground">
												{formatDateTime(t.createdAt)}
											</TableCell>
											<TableCell>
												<Badge variant={getTransactionTypeBadgeVariant(t.type)}>
													{formatTransactionType(t.type)}
												</Badge>
											</TableCell>
											<TableCell className="tabular-nums">
												{t.amount
													? currencyFormatter.format(parseFloat(t.amount))
													: "—"}
											</TableCell>
											<TableCell className="tabular-nums">
												{t.creditAmount
													? currencyFormatter.format(parseFloat(t.creditAmount))
													: "—"}
											</TableCell>
											<TableCell>
												<Badge
													variant={
														t.status === "completed"
															? "secondary"
															: t.status === "failed"
																? "destructive"
																: "outline"
													}
												>
													{t.status}
												</Badge>
											</TableCell>
											<TableCell className="max-w-[300px] truncate text-muted-foreground">
												{t.description ?? "—"}
											</TableCell>
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
					</div>
				</TabsContent>

				<TabsContent value="payment-failures">
					<div className="overflow-x-auto rounded-lg border border-border/60 bg-card">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Date</TableHead>
									<TableHead>Amount</TableHead>
									<TableHead>Decline code</TableHead>
									<TableHead>Source</TableHead>
									<TableHead>Message</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{data.paymentFailures.length === 0 ? (
									<TableRow>
										<TableCell
											colSpan={5}
											className="h-24 text-center text-muted-foreground"
										>
											No payment failures
										</TableCell>
									</TableRow>
								) : (
									data.paymentFailures.map((p) => (
										<TableRow key={p.id}>
											<TableCell className="text-muted-foreground">
												{formatDateTime(p.createdAt)}
											</TableCell>
											<TableCell className="tabular-nums">
												{p.amount
													? currencyFormatter.format(parseFloat(p.amount))
													: "—"}
											</TableCell>
											<TableCell>
												{p.declineCode ? (
													<Badge variant="outline">{p.declineCode}</Badge>
												) : (
													<span className="text-muted-foreground">—</span>
												)}
											</TableCell>
											<TableCell className="text-muted-foreground text-sm">
												{p.source ?? "—"}
											</TableCell>
											<TableCell className="max-w-[400px] truncate text-muted-foreground text-sm">
												{p.failureMessage ?? "—"}
											</TableCell>
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
					</div>
				</TabsContent>
			</Tabs>
		</div>
	);
}
