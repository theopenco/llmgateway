import {
	Activity,
	ArrowLeft,
	Building2,
	CircleDollarSign,
	Hash,
	Info,
	Receipt,
	Server,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { TokenTimeRangeToggle } from "@/components/token-time-range-toggle";
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
import {
	getOrganizationMetrics,
	getOrganizationTransactions,
	type TokenWindow,
} from "@/lib/admin-organizations";
import { cn } from "@/lib/utils";

const numberFormatter = new Intl.NumberFormat("en-US", {
	maximumFractionDigits: 0,
});

const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 4,
});

const creditsFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 2,
});

function formatDate(dateString: string) {
	return new Date(dateString).toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

function safeNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function MetricCard({
	label,
	value,
	subtitle,
	icon,
	accent,
}: {
	label: string;
	value: string;
	subtitle?: string;
	icon?: React.ReactNode;
	accent?: "green" | "blue" | "purple";
}) {
	return (
		<div className="bg-card text-card-foreground flex flex-col justify-between gap-3 rounded-xl border border-border/60 p-5 shadow-sm">
			<div className="flex items-start justify-between gap-3">
				<div>
					<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
						{label}
					</p>
					<p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
					{subtitle ? (
						<p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
					) : null}
				</div>
				{icon ? (
					<div
						className={cn(
							"inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-xs",
							accent === "green" &&
								"border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
							accent === "blue" &&
								"border-sky-500/30 bg-sky-500/10 text-sky-400",
							accent === "purple" &&
								"border-violet-500/30 bg-violet-500/10 text-violet-400",
						)}
					>
						{icon}
					</div>
				) : null}
			</div>
		</div>
	);
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

function getPlanBadgeVariant(plan: string) {
	switch (plan) {
		case "enterprise":
			return "default";
		case "pro":
			return "secondary";
		default:
			return "outline";
	}
}

function getDevPlanBadgeVariant(devPlan: string) {
	switch (devPlan) {
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

function getTransactionTypeBadgeVariant(type: string) {
	if (type.includes("cancel") || type.includes("refund")) {
		return "destructive";
	}
	if (type.includes("start") || type.includes("topup")) {
		return "default";
	}
	if (type.includes("upgrade")) {
		return "secondary";
	}
	return "outline";
}

function formatTransactionType(type: string) {
	return type.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export default async function OrganizationPage({
	params,
	searchParams,
}: {
	params: Promise<{ orgId: string }>;
	searchParams?: Promise<{ window?: string }>;
}) {
	const { orgId } = await params;
	const searchParamsData = await searchParams;
	const windowParam =
		searchParamsData?.window === "1d" || searchParamsData?.window === "7d"
			? (searchParamsData.window as TokenWindow)
			: "1d";

	const [metrics, transactionsData] = await Promise.all([
		getOrganizationMetrics(orgId, windowParam),
		getOrganizationTransactions(orgId),
	]);

	if (metrics === null) {
		return <SignInPrompt />;
	}

	if (!metrics) {
		notFound();
	}

	const org = metrics.organization;
	const transactions = transactionsData?.transactions ?? [];
	const windowLabel = windowParam === "7d" ? "Last 7 days" : "Last 24 hours";

	return (
		<div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-8">
			<div className="flex items-center gap-2">
				<Button variant="ghost" size="sm" asChild>
					<Link href="/organizations">
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
								{org.name}
							</h1>
							<p className="text-sm text-muted-foreground">{org.id}</p>
						</div>
					</div>
					<div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
						<span>{org.billingEmail}</span>
						<span>•</span>
						<span>Created {formatDate(org.createdAt)}</span>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Badge variant={getPlanBadgeVariant(org.plan)}>{org.plan}</Badge>
						{org.devPlan !== "none" && (
							<Badge variant={getDevPlanBadgeVariant(org.devPlan)}>
								Dev: {org.devPlan}
							</Badge>
						)}
						<Badge variant={org.status === "active" ? "secondary" : "outline"}>
							{org.status || "active"}
						</Badge>
						<span className="text-sm font-medium">
							Credits: {creditsFormatter.format(parseFloat(org.credits))}
						</span>
					</div>
				</div>
				<TokenTimeRangeToggle initial={windowParam} />
			</header>

			<div className="inline-flex items-center gap-1 text-xs text-muted-foreground">
				<Info className="h-3 w-3" />
				<span>
					{windowLabel} ({new Date(metrics.startDate).toLocaleDateString()} –{" "}
					{new Date(metrics.endDate).toLocaleDateString()})
				</span>
			</div>

			<section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
				<MetricCard
					label="Total Requests"
					value={numberFormatter.format(safeNumber(metrics.totalRequests))}
					subtitle="All API requests in the selected time window"
					icon={<Hash className="h-4 w-4" />}
					accent="blue"
				/>
				<MetricCard
					label="Total Tokens"
					value={numberFormatter.format(safeNumber(metrics.totalTokens))}
					subtitle={`Total tokens across all requests (${windowLabel.toLowerCase()})`}
					icon={<Activity className="h-4 w-4" />}
					accent="green"
				/>
				<MetricCard
					label="Total Cost"
					value={currencyFormatter.format(safeNumber(metrics.totalCost))}
					subtitle="Sum of metered usage costs (USD)"
					icon={<CircleDollarSign className="h-4 w-4" />}
					accent="purple"
				/>
				<MetricCard
					label="Input Tokens & Cost"
					value={`${numberFormatter.format(
						safeNumber(metrics.inputTokens),
					)} • ${currencyFormatter.format(safeNumber(metrics.inputCost))}`}
					subtitle="Prompt tokens and associated cost"
					icon={<Activity className="h-4 w-4" />}
					accent="blue"
				/>
				<MetricCard
					label="Output Tokens & Cost"
					value={`${numberFormatter.format(
						safeNumber(metrics.outputTokens),
					)} • ${currencyFormatter.format(safeNumber(metrics.outputCost))}`}
					subtitle="Completion tokens and associated cost"
					icon={<Activity className="h-4 w-4" />}
					accent="green"
				/>
				<MetricCard
					label="Cached Tokens & Cost"
					value={`${numberFormatter.format(
						safeNumber(metrics.cachedTokens),
					)} • ${currencyFormatter.format(safeNumber(metrics.cachedCost))}`}
					subtitle="Tokens and cost served from cache (if supported)"
					icon={<Server className="h-4 w-4" />}
					accent="purple"
				/>
				<MetricCard
					label="Most Used Model"
					value={metrics.mostUsedModel ?? "—"}
					subtitle={
						metrics.mostUsedModel
							? `With ${numberFormatter.format(
									safeNumber(metrics.mostUsedModelRequestCount),
								)} requests`
							: "No traffic in selected window"
					}
					icon={<Activity className="h-4 w-4" />}
					accent="blue"
				/>
				<MetricCard
					label="Most Used Provider"
					value={metrics.mostUsedProvider ?? "—"}
					subtitle={
						metrics.mostUsedProvider
							? `Provider for the most used model`
							: "No traffic in selected window"
					}
					icon={<Server className="h-4 w-4" />}
					accent="green"
				/>
			</section>

			<section className="space-y-4">
				<div className="flex items-center gap-2">
					<Receipt className="h-5 w-5 text-muted-foreground" />
					<h2 className="text-lg font-semibold">Transactions</h2>
					<span className="text-sm text-muted-foreground">
						({transactions.length})
					</span>
				</div>
				<div className="rounded-lg border border-border/60 bg-card">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Date</TableHead>
								<TableHead>Type</TableHead>
								<TableHead>Amount</TableHead>
								<TableHead>Credits</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Description</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{transactions.length === 0 ? (
								<TableRow>
									<TableCell
										colSpan={6}
										className="h-24 text-center text-muted-foreground"
									>
										No transactions found
									</TableCell>
								</TableRow>
							) : (
								transactions.map((transaction) => (
									<TableRow key={transaction.id}>
										<TableCell className="text-muted-foreground">
											{formatDate(transaction.createdAt)}
										</TableCell>
										<TableCell>
											<Badge
												variant={getTransactionTypeBadgeVariant(
													transaction.type,
												)}
											>
												{formatTransactionType(transaction.type)}
											</Badge>
										</TableCell>
										<TableCell className="tabular-nums">
											{transaction.amount
												? currencyFormatter.format(
														parseFloat(transaction.amount),
													)
												: "—"}
										</TableCell>
										<TableCell className="tabular-nums">
											{transaction.creditAmount
												? creditsFormatter.format(
														parseFloat(transaction.creditAmount),
													)
												: "—"}
										</TableCell>
										<TableCell>
											<Badge
												variant={
													transaction.status === "completed"
														? "secondary"
														: transaction.status === "failed"
															? "destructive"
															: "outline"
												}
											>
												{transaction.status}
											</Badge>
										</TableCell>
										<TableCell className="max-w-[200px] truncate text-muted-foreground">
											{transaction.description || "—"}
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
				</div>
			</section>
		</div>
	);
}
