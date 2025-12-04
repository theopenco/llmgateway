import { ArrowUpRight, CircleDollarSign, Coins, Users } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { getAdminDashboardMetrics } from "@/lib/admin-metrics";
import { cn } from "@/lib/utils";

const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat("en-US", {
	maximumFractionDigits: 0,
});

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
							"inline-flex h-9 w-9 items-center justify-center rounded-full border text-xs",
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

export default async function Page() {
	const metrics = await getAdminDashboardMetrics();

	if (!metrics) {
		return <SignInPrompt />;
	}

	return (
		<div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-8">
			<header className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
				<div>
					<h1 className="text-3xl font-semibold tracking-tight">
						Admin Dashboard
					</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						High-level overview of global usage, revenue, and customers.
					</p>
				</div>
				<div className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
					<span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
					<span>Live data</span>
				</div>
			</header>

			<section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
				<MetricCard
					label="Total Credits Issued"
					value={currencyFormatter.format(metrics.totalCreditsIssued)}
					subtitle="Lifetime credits added to all organizations"
					icon={<Coins className="h-4 w-4" />}
					accent="purple"
				/>
				<MetricCard
					label="Total Revenue"
					value={currencyFormatter.format(metrics.totalRevenue)}
					subtitle="All completed subscription and credit payments"
					icon={<CircleDollarSign className="h-4 w-4" />}
					accent="green"
				/>
				<MetricCard
					label="Net Profit (approx.)"
					value={currencyFormatter.format(metrics.netProfit)}
					subtitle="Revenue minus metered usage costs"
					icon={<ArrowUpRight className="h-4 w-4" />}
					accent="blue"
				/>
				<MetricCard
					label="Total Sign Ups"
					value={numberFormatter.format(metrics.totalSignups)}
					subtitle="All registered user accounts"
					icon={<Users className="h-4 w-4" />}
					accent="blue"
				/>
				<MetricCard
					label="Verified Users"
					value={numberFormatter.format(metrics.verifiedUsers)}
					subtitle="Users with verified email addresses"
					icon={<Users className="h-4 w-4" />}
					accent="green"
				/>
				<MetricCard
					label="Paying Customers"
					value={numberFormatter.format(metrics.payingCustomers)}
					subtitle="Organizations with at least one completed transaction"
					icon={<Users className="h-4 w-4" />}
					accent="purple"
				/>
			</section>
		</div>
	);
}
