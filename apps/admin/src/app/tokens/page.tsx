import { Activity, CircleDollarSign, Hash, Info, Server } from "lucide-react";
import Link from "next/link";

import { TokenTimeRangeToggle } from "@/components/token-time-range-toggle";
import { Button } from "@/components/ui/button";
import {
	getAdminTokenMetrics,
	type TokenWindow,
} from "@/lib/admin-token-metrics";
import { cn } from "@/lib/utils";

const numberFormatter = new Intl.NumberFormat("en-US", {
	maximumFractionDigits: 0,
});

const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 4,
});

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

export default async function TokensPage({
	searchParams,
}: {
	searchParams?: Promise<{ window?: string }>;
}) {
	const params = await searchParams;
	const windowParam =
		params?.window === "30d" || params?.window === "7d"
			? (params.window as TokenWindow)
			: "7d";

	const metrics = await getAdminTokenMetrics(windowParam);

	if (!metrics) {
		return <SignInPrompt />;
	}

	const windowLabel = windowParam === "30d" ? "Last 30 days" : "Last 7 days";

	return (
		<div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-8">
			<header className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
				<div>
					<h1 className="text-3xl font-semibold tracking-tight">Token Usage</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Precise request, token, and cost breakdown across your gateway.
					</p>
					<p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
						<Info className="h-3 w-3" />
						<span>
							{windowLabel} ({new Date(metrics.startDate).toLocaleDateString()}{" "}
							– {new Date(metrics.endDate).toLocaleDateString()})
						</span>
					</p>
				</div>
				<TokenTimeRangeToggle initial={windowParam} />
			</header>

			<section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
				<MetricCard
					label="Total Requests"
					value={numberFormatter.format(safeNumber(metrics.totalRequests))}
					subtitle="All gateway requests in the selected time window"
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
		</div>
	);
}
